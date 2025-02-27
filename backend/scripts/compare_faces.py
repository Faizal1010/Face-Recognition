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
warnings.filterwarnings("ignore")
os.environ["ORT_DISABLE_CUDA"] = "1"
os.environ['INSIGHTFACE_LOG_LEVEL'] = 'ERROR'

import onnxruntime
onnxruntime.set_default_logger_severity(3)
sys.stderr = open(os.devnull, 'w')
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
        faces = app.get(img)

        if len(faces) == 0:
            print(json.dumps([]))  # No face detected in the query image
            return
        
        # Use the first detected face for comparison (you can modify this if needed)
        query_embedding = faces[0].normed_embedding

        # Connect to the database
        conn = mysql.connector.connect(
            host='localhost', 
            user='root', 
            password='zxcvbnm1010@', 
            database='face_recognition'
        )
        cursor = conn.cursor()

        # Ensure labels are formatted correctly (if provided)
        label_filter = json.loads(label_filter) if isinstance(label_filter, str) else label_filter
        if not isinstance(label_filter, list):
            label_filter = []

        # If no label_filter is provided, we'll set it to an empty list
        if label_filter is None:
            label_filter = []

        # Event code filter should always be provided
        if not event_code_filter:
            print(json.dumps({"error": "Event code is required."}))
            return

        # Format label and event_code filter
        format_label_strings = ','.join(['%s'] * len(label_filter)) if label_filter else ''
        format_event_strings = ','.join(['%s'] * len(event_code_filter)) if event_code_filter else ''

        query = f"""
            SELECT imageData.id, imageData.embeddings
            FROM imageData
            JOIN images ON imageData.image_id = images.id
            JOIN events ON images.event_code = events.event_code
            WHERE images.event_code IN ({format_event_strings}) 
        """
        
        # Add the label filter to the query if provided
        if label_filter:
            query += f" AND images.label IN ({format_label_strings})"

        filter_params = label_filter + event_code_filter
        
        cursor.execute(query, filter_params)

        matched_images = []

        # Compare the query image embedding with the filtered stored embeddings
        for (img_id, stored_embedding) in cursor.fetchall():
            stored_embedding = np.frombuffer(stored_embedding, dtype=np.float32)
            similarity = np.dot(query_embedding, stored_embedding)  # Cosine similarity

            if similarity > 0.4:  # Threshold for a match
                matched_images.append(img_id)

        # Close the database connection
        cursor.close()
        conn.close()

        # Return the result in JSON format
        if matched_images:
            print(json.dumps({"status": "match_found", "matched_images": matched_images}))
        else:
            print(json.dumps({"status": "no_match_found"}))

    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    # Get the image path, labels array, and event_code from command line arguments
    image_path = sys.argv[1]
    label_filter = sys.argv[2] if len(sys.argv) > 2 else "[]"
    event_code_filter = sys.argv[3] if len(sys.argv) > 3 else None
    
    if not event_code_filter:
        print(json.dumps({"error": "Event code is required."}))
    else:
        compare_faces(image_path, label_filter, [event_code_filter])
