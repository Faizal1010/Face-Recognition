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

def extract_and_store(image_paths, label=None):
    conn = mysql.connector.connect(
        host='localhost',
        user='root',
        password='zxcvbnm1010@',
        database='face_recognition'
    )
    cursor = conn.cursor()

    for image_path in image_paths:
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
            cursor.execute("INSERT INTO images (image, label) VALUES (%s, %s)", (img_data, label))
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
    image_paths = sys.argv[1:-1]
    label = sys.argv[-1] if len(sys.argv) > 1 else None
    extract_and_store(image_paths, label)
