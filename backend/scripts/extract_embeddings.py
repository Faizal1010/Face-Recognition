import os
import warnings
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"  # Disable GPU usage for ONNX Runtime
os.environ["ORT_DISABLE_CUDA"] = "1"       # Ensure ONNX runs only on CPU

# Suppress the specific warning about CUDAExecutionProvider not being available
warnings.filterwarnings("ignore", category=UserWarning, message=".*CUDAExecutionProvider.*")

import cv2
import numpy as np
import insightface
from insightface.app import FaceAnalysis
import mysql.connector
import sys
import json
import time

# Initialize face analysis
app = FaceAnalysis()
app.prepare(ctx_id=-1, det_size=(640, 640))  # Use CPU explicitly

# Batch size to prevent overload
BATCH_SIZE = 5

def extract_and_store(image_paths, labels, client_ids, event_codes):
    if len(image_paths) != len(labels) or len(image_paths) != len(client_ids) or len(image_paths) != len(event_codes):
        print(json.dumps({"status": "error", "message": "Mismatched number of images, labels, client_ids, and event_codes"}))
        return

    # Connecting to MySQL
    try:
        conn = mysql.connector.connect(
            host='localhost',
            user='root',
            password='zxcvbnm1010@',
            database='face_recognition'
        )
        cursor = conn.cursor()
    except mysql.connector.Error as err:
        print(json.dumps({"status": "error", "message": f"MySQL Connection Failed: {err}"}))
        return

    results = []
    progress = {"status": "progress", "processed": 0, "total": len(image_paths)}

    for i in range(0, len(image_paths), BATCH_SIZE):
        batch_paths = image_paths[i: i + BATCH_SIZE]
        batch_labels = labels[i: i + BATCH_SIZE]
        batch_client_ids = client_ids[i: i + BATCH_SIZE]
        batch_event_codes = event_codes[i: i + BATCH_SIZE]

        for image_path, label, client_id, event_code in zip(batch_paths, batch_labels, batch_client_ids, batch_event_codes):
            time.sleep(0.1)  # Avoid overloading system

            img = cv2.imread(image_path)
            if img is None:
                results.append({"status": "error", "message": f"Failed to load image {image_path}"})
                continue

            faces = app.get(img)

            with open(image_path, 'rb') as img_file:
                img_data = img_file.read()
                try:
                    cursor.execute("""
                        INSERT INTO images (image, label, client_id, event_code)
                        VALUES (%s, %s, %s, %s)
                    """, (img_data, label, client_id, event_code))
                    img_id = cursor.lastrowid
                except mysql.connector.Error as err:
                    results.append({"status": "error", "message": f"MySQL Insert Failed: {err}"})
                    continue

            if len(faces) == 0:
                results.append({"status": "No face found", "image_id": img_id, "image": image_path})
            else:
                face_data = []
                for idx, face in enumerate(faces):
                    embeddings = face.normed_embedding
                    try:
                        cursor.execute(
                            "INSERT INTO imageData (image_id, embeddings, headers) VALUES (%s, %s, %s)",
                            (img_id, embeddings.tobytes(), f'Face {idx+1}')
                        )
                        face_data.append(f'Face {idx+1}')
                    except mysql.connector.Error as err:
                        results.append({"status": "error", "message": f"MySQL Insert Failed: {err}"})
                        continue
                results.append({"status": "success", "id": img_id, "faces_detected": len(faces), "image": image_path, "faces": face_data})

        conn.commit()  # Commit after batch

        # Update progress after processing each batch
        progress["processed"] += len(batch_paths)

    cursor.close()
    conn.close()

    # Combine the progress and results into one output
    final_output = {
        "status": "completed",
        "progress": progress,
        "results": results
    }

    # Output final result
    print(json.dumps(final_output))

if __name__ == "__main__":
    json_file_path = sys.argv[1]

    try:
        with open(json_file_path, 'r', encoding='utf-8') as file:
            json_data = json.load(file)

        file_paths = json_data["filePaths"]
        client_id = json_data["client_id"]
        event_code = json_data["event_code"]
        label = json_data["label"]

        extract_and_store(file_paths, [label] * len(file_paths), [client_id] * len(file_paths), [event_code] * len(file_paths))
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Failed to read JSON file: {str(e)}"}))
