const mysql = require('mysql2');
const sharp = require('sharp');

// DB Connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'zxcvbnm1010@',
    database: 'face_recognition'
});


exports.getImages = (req, res) => {
    let { page, limit, eventId } = req.query; // If you're passing eventId in query params
    console.log("Selected Event ID from getImages:", eventId);

    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;
    const offset = (pageNum - 1) * pageSize;

    // Modify query to include event_code filter (eventId)
    const query = 'SELECT id, image FROM images WHERE event_code = ? ORDER BY id ASC LIMIT ? OFFSET ?';
    db.query(query, [eventId, pageSize, offset], (err, results) => {
        if (err) {
            console.error('Error fetching images:', err);
            return res.status(500).json({ error: 'Error fetching images' });
        }

        // Compress images with sharp before converting to base64
        Promise.all(results.map(r =>
            sharp(r.image)
                .jpeg({ quality: 60 }) // Compress to JPEG with 85% quality (adjustable)
                .toBuffer()
                .then(compressedBuffer => ({
                    id: r.id,
                    data: compressedBuffer.toString('base64')
                }))
        ))
        .then(images => {
            // Get total count for pagination metadata
            const countQuery = 'SELECT COUNT(*) AS total FROM images WHERE event_code = ?';
            db.query(countQuery, [eventId], (err, countResult) => {
                if (err) {
                    console.error('Error fetching total count:', err);
                    return res.status(500).json({ error: 'Error fetching total count' });
                }

                const total = countResult[0].total;
                const totalPages = Math.ceil(total / pageSize);

                res.json({ images, page: pageNum, totalPages, total });
            });
        })
        .catch(err => {
            console.error("Error compressing images:", err);
            res.status(500).json({ error: "Error compressing images" });
        });
    });
};


exports.deleteImage = (req, res) => {
    const { label, event_code } = req.body;

    console.log(label, " and ", event_code)

    if (!label || !event_code) {
        return res.status(400).json({ error: 'Both label and event_code are required' });
    }

    console.log("Deleting images with labels:", label);
    console.log("For event_code:", event_code);

    // Step 1: Loop through each label in the provided array
    const deletePromises = label.map((singleLabel) => {
        return new Promise((resolve, reject) => {
            // Step 2: Find images that match the current label and event_code
            const selectQuery = 'SELECT id FROM images WHERE event_code = ? AND label = ?';

            db.query(selectQuery, [event_code, singleLabel], (err, results) => {
                if (err) {
                    console.error(`Error fetching images for label "${singleLabel}":`, err);
                    return reject(err); // Reject if there's an error fetching images
                }

                if (results.length === 0) {
                    console.log(`No images found for label "${singleLabel}" and event_code "${event_code}"`);
                    return resolve(); // Resolve if no images are found (continue to next label)
                }

                // Step 3: For each image, delete references from imageData first, then from images
                const deletePromisesForLabel = results.map(image => {
                    return new Promise((resolve, reject) => {
                        // First, delete references from imageData table
                        db.query('DELETE FROM imageData WHERE image_id = ?', [image.id], (err, result) => {
                            if (err) {
                                console.error(`Error deleting image data for image id ${image.id}:`, err);
                                return reject(err);
                            }

                            console.log(`Deleted from imageData for image id ${image.id}`);

                            // Now, delete from images table
                            db.query('DELETE FROM images WHERE id = ?', [image.id], (err, result) => {
                                if (err) {
                                    console.error(`Error deleting image from images table for image id ${image.id}:`, err);
                                    return reject(err);
                                }

                                console.log(`Deleted image id ${image.id} from images table`);
                                resolve(result);
                            });
                        });
                    });
                });

                // Step 4: Wait for all deletions for this label to finish
                Promise.all(deletePromisesForLabel)
                    .then(() => resolve()) // Resolve when all images for this label have been deleted
                    .catch(reject); // Reject if there's an error deleting any of the images
            });
        });
    });

    // Step 5: Wait for all labels to be processed and deleted
    Promise.all(deletePromises)
        .then(() => {
            res.json({ message: 'Images deleted successfully' });
        })
        .catch((err) => {
            console.error('Error deleting images:', err);
            res.status(500).json({ error: 'Error deleting images' });
        });
};


exports.getLabels = (req, res) => {
    const eventId = req.params.eventId; // Get eventId from request body

    if (!eventId) {
        return res.status(400).json({ error: 'eventId is required' }); // Check if eventId is provided
    }

    // Modify the query to filter by event_code
    db.query('SELECT label FROM images WHERE event_code = ?', [eventId], (err, results) => {
        if (err) {
            console.error('Error fetching labels:', err);
            return res.status(500).json({ error: 'Error fetching labels' }); // Send JSON error response
        }

        // Extract the labels from the results
        const labels = results.map(r => r.label);

        res.json(labels); // Send the list of labels as a JSON response
    });
};


exports.updateLabels = (req, res) => {
    const { label, newLabel, event_code } = req.body;

    // Validate input
    if (!label || !newLabel || !event_code) {
        return res.status(400).json({ error: 'label, newLabel, and event_code are required' });
    }

    console.log("label:", label);
    console.log("newLabel:", newLabel);
    console.log("event_code:", event_code);

    // Step 1: Loop through each label in the provided array
    const updatePromises = label.map((singleLabel) => {
        return new Promise((resolve, reject) => {
            // Step 2: Find images that match the current label and event_code
            const selectQuery = 'SELECT id FROM images WHERE event_code = ? AND label = ?';

            db.query(selectQuery, [event_code, singleLabel], (err, results) => {
                if (err) {
                    console.error(`Error fetching images for label "${singleLabel}":`, err);
                    return reject(err); // Reject the promise if there's an error fetching images
                }

                if (results.length === 0) {
                    console.log(`No images found for label "${singleLabel}" and event_code "${event_code}"`);
                    return resolve(); // Resolve if no images are found (continue to next label)
                }

                // Step 3: Update each matching image's label to the newLabel
                const updateQuery = 'UPDATE images SET label = ? WHERE id = ?';

                // Loop over each image and update its label
                const updatePromisesForLabel = results.map(image => {
                    return new Promise((resolve, reject) => {
                        db.query(updateQuery, [newLabel, image.id], (err, updateResult) => {
                            if (err) {
                                return reject(err);
                            }
                            resolve(updateResult);
                        });
                    });
                });

                // Step 4: Wait for all updates for this label to finish
                Promise.all(updatePromisesForLabel)
                    .then(() => resolve()) // Resolve when all images for this label have been updated
                    .catch(reject); // Reject if there's an error updating any of the images
            });
        });
    });

    // Step 5: Wait for all labels to be processed and updated
    Promise.all(updatePromises)
        .then(() => {
            res.json({ message: 'Labels updated successfully' });
        })
        .catch((err) => {
            console.error('Error updating labels:', err);
            res.status(500).json({ error: 'Error updating labels' });
        });
};


exports.deleteSelectedImages = (req, res) => {
    console.log("handler hit")
    const { ids } = req.body;
    console.log("imageIds", ids)

    if (!ids || ids.length === 0) {
        return res.status(400).json({ error: 'No image IDs provided' });
    }

    db.query('DELETE FROM imageData WHERE image_id IN (?)', [ids], (err, result) => {
        if (err) {
            console.error('Error deleting image data:', err);
            return res.status(500).json({ error: 'Error deleting image data' });
        }

        db.query('DELETE FROM images WHERE id IN (?)', [ids], (err, result) => {
            if (err) {
                console.error('Error deleting images:', err);
                return res.status(500).json({ error: 'Error deleting images' });
            }

            res.json({ message: 'Images deleted successfully', affectedRows: result.affectedRows });
        });
    });
};

exports.getImagesByLabels = (req, res) => {
    const { labels, page, limit, eventId } = req.body; // Extract eventId from the body
    console.log("Selected Event ID from getImagesByLabels:", eventId);

    if (!labels || labels.length === 0) {
        return res.status(400).json({ error: "No labels provided" });
    }

    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;
    const offset = (pageNum - 1) * pageSize;

    // Modify query to include event_code filter (eventId)
    const query = 'SELECT id, image FROM images WHERE FIND_IN_SET(label, ?) AND event_code = ? ORDER BY id ASC LIMIT ? OFFSET ?';
    db.query(query, [labels.join(','), eventId, pageSize, offset], (err, results) => {
        if (err) {
            console.error("Error fetching images by labels:", err);
            return res.status(500).json({ error: "Error fetching images" });
        }

        // Compress images with sharp before converting to base64
        Promise.all(results.map(r =>
            sharp(r.image)
                .jpeg({ quality: 85 }) // Compress to JPEG with 85% quality (adjustable)
                .toBuffer()
                .then(compressedBuffer => ({
                    id: r.id,
                    data: compressedBuffer.toString('base64')
                }))
        ))
        .then(images => {
            // Get total count for pagination
            const countQuery = 'SELECT COUNT(*) AS total FROM images WHERE FIND_IN_SET(label, ?) AND event_code = ?';
            db.query(countQuery, [labels.join(','), eventId], (err, countResult) => {
                if (err) {
                    console.error("Error fetching total count:", err);
                    return res.status(500).json({ error: "Error fetching total count" });
                }

                const total = countResult[0].total;
                const totalPages = Math.ceil(total / pageSize);

                res.json({ images, page: pageNum, totalPages, total });
            });
        })
        .catch(err => {
            console.error("Error compressing images:", err);
            res.status(500).json({ error: "Error compressing images" });
        });
    });
};

exports.deleteImagesByIds = (req, res) => {
    const { imageIds } = req.body; // Array of image IDs from the request body

    // Check if imageIds array is provided and is not empty
    if (!Array.isArray(imageIds) || imageIds.length === 0) {
        return res.status(400).json({ error: 'An array of image IDs is required' });
    }

    console.log("Deleting images with IDs:", imageIds);

    // Step 1: Loop through each image ID in the provided array
    const deletePromises = imageIds.map((imageId) => {
        return new Promise((resolve, reject) => {
            // Step 2: Delete image references from imageData table first
            db.query('DELETE FROM imageData WHERE image_id = ?', [imageId], (err, result) => {
                if (err) {
                    console.error(`Error deleting image data for image id ${imageId}:`, err);
                    return reject(err); // Reject if there's an error deleting from imageData
                }

                console.log(`Deleted from imageData for image id ${imageId}`);

                // Step 3: Now delete the image from the images table
                db.query('DELETE FROM images WHERE id = ?', [imageId], (err, result) => {
                    if (err) {
                        console.error(`Error deleting image from images table for image id ${imageId}:`, err);
                        return reject(err); // Reject if there's an error deleting from images
                    }

                    console.log(`Deleted image id ${imageId} from images table`);
                    resolve(result); // Resolve if deletion is successful
                });
            });
        });
    });

    // Step 4: Wait for all deletions to finish
    Promise.all(deletePromises)
        .then(() => {
            res.json({ message: 'Images deleted successfully' });
        })
        .catch((err) => {
            console.error('Error deleting images:', err);
            res.status(500).json({ error: 'Error deleting images' });
        });
};

exports.updateLabelsById = (req, res) => {
    const { newLabel, imageIds } = req.body; // newLabel and array of image IDs from request body

    // Validate the input
    if (!newLabel || !Array.isArray(imageIds) || imageIds.length === 0) {
        return res.status(400).json({ error: 'newLabel and an array of image IDs are required' });
    }

    console.log("Updating images with IDs:", imageIds, "to new label:", newLabel);

    // Step 1: Loop through each image ID in the provided array
    const updatePromises = imageIds.map((imageId) => {
        return new Promise((resolve, reject) => {
            // Step 2: Update the label of the image with the given imageId
            const updateQuery = 'UPDATE images SET label = ? WHERE id = ?';

            db.query(updateQuery, [newLabel, imageId], (err, result) => {
                if (err) {
                    console.error(`Error updating label for image id ${imageId}:`, err);
                    return reject(err); // Reject if there's an error updating the label
                }

                console.log(`Updated label for image id ${imageId} to "${newLabel}"`);
                resolve(result); // Resolve if the label was updated successfully
            });
        });
    });

    // Step 3: Wait for all label updates to finish
    Promise.all(updatePromises)
        .then(() => {
            res.json({ message: 'Labels updated successfully' });
        })
        .catch((err) => {
            console.error('Error updating labels:', err);
            res.status(500).json({ error: 'Error updating labels' });
        });
};

exports.getOriginalImage = (req, res) => {
    console.log('hit')
    const { id } = req.params; // Image ID from URL parameter
    console.log("Fetching original image with ID:", id);

    const query = 'SELECT image FROM images WHERE id = ?';
    db.query(query, [id], (err, results) => {
        if (err) {
            console.error("Error fetching original image:", err);
            return res.status(500).json({ error: "Error fetching original image" });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: "Image not found" });
        }

        const imageBuffer = results[0].image;
        res.set('Content-Type', 'image/jpeg'); // Set the correct MIME type
        res.set('Content-Disposition', `attachment; filename="image_${id}.jpg"`); // Suggest a filename
        res.send(imageBuffer); // Send the raw buffer (original quality)
    });
};

exports.downloadAllSelectedImages = (req, res) => {
    const { labels, eventId } = req.body;
    console.log("Selected Labels and Event ID for download:", labels, eventId);

    if (!labels || labels.length === 0 || !eventId) {
        return res.status(400).json({ error: "Labels and eventId are required" });
    }

    // Query to fetch all images matching the selected labels and eventId
    const query = 'SELECT id, image FROM images WHERE FIND_IN_SET(label, ?) AND event_code = ? ORDER BY id ASC';
    db.query(query, [labels.join(','), eventId], (err, results) => {
        if (err) {
            console.error("Error fetching images for download:", err);
            return res.status(500).json({ error: "Error fetching images" });
        }

        if (results.length === 0) {
            return res.status(200).json({ images: [] });
        }

        // Prepare images as an array of { id, data } with original buffers converted to base64
        const images = results.map(r => ({
            id: r.id,
            data: Buffer.from(r.image).toString('base64') // Original image, no compression
        }));

        res.json({ images });
    });
};