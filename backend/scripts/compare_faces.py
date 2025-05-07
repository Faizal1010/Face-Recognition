import cv2
import numpy as np
import insightface
from insightface.app import FaceAnalysis
import mysql.connector
import sys
import json
import os
import warnings
import logging

# Suppressing warnings and unnecessary logs
warnings.filterwarnings("ignore", category=UserWarning)  # Suppress all UserWarnings
os.environ["ORT_DISABLE_CUDA"] = "1"
os.environ['INSIGHTFACE_LOG_LEVEL'] = 'ERROR'
os.environ['NO_ALBUMENTATIONS_UPDATE'] = '1'  # Suppress Albumentations version warning

import onnxruntime
onnxruntime.set_default_logger_severity(3)
sys.stderr = open(os.devnull, 'w')  # Redirect stderr to null to avoid warnings
logging.getLogger().disabled = True

class CustomFaceAnalysis(FaceAnalysis):
    def prepare(self, ctx_id, det_thresh=0.5, det_size=(640, 640)):
        self.det_thresh = det_thresh
        assert det_size is not None
        self.det_size = det_size
        for taskname, model in self.models.items():
            if taskname == 'detection':
                model.prepare(ctx_id, input_size=det_size, det_thresh=det_thresh)
            else:
                model.prepare(ctx_id)

# Initialize the custom face analysis class
app = CustomFaceAnalysis()
app.prepare(ctx_id=-1, det_size=(640, 640))

def compare_faces(image_path, label_filter, event_code_filter):
    try:
        # Read the query image
        img = cv2.imread(image_path)
        if img is None:
            return {"error": f"Failed to load image at {image_path}"}
        
        faces = app.get(img)
        if len(faces) == 0:
            return {"status": "no_match_found"}
        
        # Use the first detected face for comparison
        query_embedding = faces[0].normed_embedding

        # Connect to the database
        conn = mysql.connector.connect(
            host='localhost', 
            user='root', 
            password='zxcvbnm1010@', 
            database='face_recognition'
        )
        cursor = conn.cursor()

        # Ensure labels and event_code are lists
        label_filter = json.loads(label_filter) if isinstance(label_filter, str) else label_filter
        if not isinstance(label_filter, list):
            label_filter = []
        event_code_filter = [event_code_filter] if event_code_filter else []

        format_label_strings = ','.join(['%s'] * len(label_filter)) if label_filter else ''
        format_event_strings = ','.join(['%s'] * len(event_code_filter)) if event_code_filter else ''

        query = f"""
            SELECT imageData.id, imageData.embeddings
            FROM imageData
            JOIN images ON imageData.image_id = images.id
            JOIN events ON images.event_code = events.event_code
            WHERE images.event_code IN ({format_event_strings}) 
        """
        if label_filter:
            query += f" AND images.label IN ({format_label_strings})"

        cursor.execute(query, event_code_filter + label_filter)
        rows = cursor.fetchall()

        matched_images = []
        for (img_id, stored_embedding) in rows:
            try:
                stored_embedding = np.frombuffer(stored_embedding, dtype=np.float32)
                if stored_embedding.size == 0:
                    continue  # Skip invalid embeddings
                similarity = np.dot(query_embedding, stored_embedding)
                if similarity > 0.4:
                    matched_images.append(img_id)
            except Exception as e:
                print(f"Warning: Error processing embedding for img_id {img_id}: {str(e)}", file=sys.stderr)

        cursor.close()
        conn.close()

        if matched_images:
            return {"status": "match_found", "matched_images": matched_images}
        else:
            return {"status": "no_match_found"}

    except Exception as e:
        return {"error": f"Error recognizing image: {str(e)}"}

if __name__ == "__main__":
    json_file_path = sys.argv[1]
    try:
        with open(json_file_path, 'r', encoding='utf-8') as file:
            json_data = json.load(file)
        image_path = json_data["imagePath"]
        label_filter = json_data["labels"]
        event_code_filter = json_data["event_code"]
        if not event_code_filter:
            result = {"error": "Event code is required."}
        else:
            result = compare_faces(image_path, label_filter, event_code_filter)
        
        # Write result to the same JSON file
        with open(json_file_path, 'w', encoding='utf-8') as file:
            json.dump(result, file)
        
    except Exception as e:
        # Write error to the same JSON file
        with open(json_file_path, 'w', encoding='utf-8') as file:
            json.dump({"error": f"Failed to read JSON file: {str(e)}"}, file)
        sys.exit(1)