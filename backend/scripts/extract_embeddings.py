import cv2
import numpy as np
import insightface
from insightface.app import FaceAnalysis
import mysql.connector
import sys
import json
import os
import time

# Initialize face analysis
app = FaceAnalysis()
os.environ["ORT_DISABLE_CUDA"] = "1"  # Disable CUDA for CPU
app.prepare(ctx_id=-1, det_size=(640, 640))  # Use CPU explicitly

def extract_and_store(image_paths, labels, client_ids, event_codes):
    # Ensure that image_paths, labels, client_ids, and event_codes have the same length
    if len(image_paths) != len(labels) or len(image_paths) != len(client_ids) or len(image_paths) != len(event_codes):
        print(json.dumps({"status": "error", "message": "Mismatched number of images, labels, client_ids, and event_codes"}))
        return

    conn = mysql.connector.connect(
        host='localhost',
        user='root',
        password='zxcvbnm1010@',
        database='face_recognition'
    )
    cursor = conn.cursor()

    # Process each image
    for image_path, label, client_id, event_code in zip(image_paths, labels, client_ids, event_codes):
        # Add a delay between each image processing
        time.sleep(0.1)
        
        img = cv2.imread(image_path)
        if img is None:
            print(json.dumps({"status": "error", "message": f"Failed to load image {image_path}"}))
            continue

        faces = app.get(img)

        if label is None:
            label = "Unknown"

        with open(image_path, 'rb') as img_file:
            img_data = img_file.read()
            # Insert image data into the 'images' table, including client_id and event_code
            cursor.execute("""
                INSERT INTO images (image, label, client_id, event_code)
                VALUES (%s, %s, %s, %s)
            """, (img_data, label, client_id, event_code))
            img_id = cursor.lastrowid

        if len(faces) == 0:
            print(json.dumps({"status": "No face found", "image_id": img_id, "image": image_path}))
        else:
            for i, face in enumerate(faces):
                embeddings = face.normed_embedding
                cursor.execute(
                    "INSERT INTO imageData (image_id, embeddings, headers) VALUES (%s, %s, %s)",
                    (img_id, embeddings.tobytes(), f'Face {i+1}')
                )
            print(json.dumps({"status": "success", "id": img_id, "faces_detected": len(faces), "image": image_path}))

        conn.commit()

    cursor.close()
    conn.close()

if __name__ == "__main__":
    # Expect the image paths, client_ids, event_codes, and label as command-line arguments
    image_paths = sys.argv[1:-3]  # All but the last three arguments are image paths
    client_ids = sys.argv[-3]  # The third-to-last argument is the client_id
    event_codes = sys.argv[-2]  # The second-to-last argument is the event_code
    label = sys.argv[-1]  # The last argument is the label

    # Ensure that label is not empty
    if label is None or label == "":
        print(json.dumps({"status": "error", "message": "Label is required"}))
    else:
        extract_and_store(image_paths, [label] * len(image_paths), [client_ids] * len(image_paths), [event_codes] * len(image_paths))








# How to Pass the Data to the Script:
# You need to pass the client_id and event_code as command-line arguments, in addition to the image paths and labels. For example, when running the script from the command line:

# bash
# Copy
#                   python your_script.py path_to_image1 path_to_image2 ... client_id1 client_id2 ... event_code1 event_code2 ... label1 label2 ...
# Example Command:

# bash
# Copy
#                    python your_script.py image1.jpg image2.jpg A123 A124 EVT001 EVT002 Label1 Label2
# Breakdown of Command:
# image1.jpg, image2.jpg: The paths of the images you want to upload.
# A123, A124: The client_id values corresponding to each image.
# EVT001, EVT002: The event_code values corresponding to each image.
# Label1, Label2: The labels for each image (optional).