const mysql = require('mysql2');
const sharp = require('sharp');
const archiver = require('archiver');

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
                .jpeg({ quality: 50 }) // Compress to JPEG with 85% quality (adjustable)
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
            // Step 2: Find images that match the current label and event_code, including image data and client_id
            const selectQuery = 'SELECT id, client_id, LENGTH(image) as image_size FROM images WHERE event_code = ? AND label = ?';

            db.query(selectQuery, [event_code, singleLabel], (err, results) => {
                if (err) {
                    console.error(`Error fetching images for label "${singleLabel}":`, err);
                    return reject(err);
                }

                if (results.length === 0) {
                    console.log(`No images found for label "${singleLabel}" and event_code "${event_code}"`);
                    return resolve();
                }

                // Calculate total size of images to be deleted (in MB)
                const totalSizeMB = results.reduce((total, image) => {
                    return total + (image.image_size / (1024 * 1024)); // Convert bytes to MB
                }, 0);

                // Get the client_id (assuming all images in this batch have the same client_id)
                const clientId = results[0].client_id;

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

                // Step 4: Wait for all deletions for this label to finish, then update Storage_used
                Promise.all(deletePromisesForLabel)
                    .then(() => {
                        // Update Storage_used for the client
                        db.query(
                            'UPDATE client SET Storage_used = GREATEST(0, Storage_used - ?) WHERE CustomerId = ?',
                            [totalSizeMB, clientId],
                            (err, updateResult) => {
                                if (err) {
                                    console.error(`Error updating Storage_used for client ${clientId}:`, err);
                                    return reject(err);
                                }
                                console.log(`Subtracted ${totalSizeMB} MB from Storage_used for client ${clientId}`);
                                resolve();
                            }
                        );
                    })
                    .catch(reject);
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

    // Step 1: Fetch image sizes and client_id before deleting
    db.query('SELECT client_id, LENGTH(image) as image_size FROM images WHERE id IN (?)', [ids], (err, results) => {
        if (err) {
            console.error('Error fetching image sizes:', err);
            return res.status(500).json({ error: 'Error fetching image sizes' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'No images found for the provided IDs' });
        }

        // Calculate total size of images to be deleted (in MB)
        const totalSizeMB = results.reduce((total, image) => {
            return total + (image.image_size / (1024 * 1024)); // Convert bytes to MB
        }, 0);

        // Get the client_id (assuming all images have the same client_id)
        const clientId = results[0].client_id;

        // Step 2: Delete from imageData
        db.query('DELETE FROM imageData WHERE image_id IN (?)', [ids], (err, result) => {
            if (err) {
                console.error('Error deleting image data:', err);
                return res.status(500).json({ error: 'Error deleting image data' });
            }

            // Step 3: Delete from images
            db.query('DELETE FROM images WHERE id IN (?)', [ids], (err, result) => {
                if (err) {
                    console.error('Error deleting images:', err);
                    return res.status(500).json({ error: 'Error deleting images' });
                }

                // Step 4: Update Storage_used for the client
                db.query(
                    'UPDATE client SET Storage_used = GREATEST(0, Storage_used - ?) WHERE CustomerId = ?',
                    [totalSizeMB, clientId],
                    (err, updateResult) => {
                        if (err) {
                            console.error(`Error updating Storage_used for client ${clientId}:`, err);
                            return res.status(500).json({ error: 'Error updating storage usage' });
                        }

                        console.log(`Subtracted ${totalSizeMB} MB from Storage_used for client ${clientId}`);
                        res.json({ message: 'Images deleted successfully', affectedRows: result.affectedRows });
                    }
                );
            });
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
                .jpeg({ quality: 50 }) // Compress to JPEG with 85% quality (adjustable)
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
    const { imageIds } = req.body;

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
        return res.status(400).json({ error: 'An array of image IDs is required' });
    }

    console.log("Deleting images with IDs:", imageIds);

    // Step 1: Fetch image sizes and client_id before deleting
    db.query('SELECT client_id, LENGTH(image) as image_size FROM images WHERE id IN (?)', [imageIds], (err, results) => {
        if (err) {
            console.error('Error fetching image sizes:', err);
            return res.status(500).json({ error: 'Error fetching image sizes' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'No images found for the provided IDs' });
        }

        // Calculate total size of images to be deleted (in MB)
        const totalSizeMB = results.reduce((total, image) => {
            return total + (image.image_size / (1024 * 1024)); // Convert bytes to MB
        }, 0);

        // Get the client_id (assuming all images have the same client_id)
        const clientId = results[0].client_id;

        // Step 2: Loop through each image ID in the provided array
        const deletePromises = imageIds.map((imageId) => {
            return new Promise((resolve, reject) => {
                // Delete image references from imageData table first
                db.query('DELETE FROM imageData WHERE image_id = ?', [imageId], (err, result) => {
                    if (err) {
                        console.error(`Error deleting image data for image id ${imageId}:`, err);
                        return reject(err);
                    }

                    console.log(`Deleted from imageData for image id ${imageId}`);

                    // Now delete the image from the images table
                    db.query('DELETE FROM images WHERE id = ?', [imageId], (err, result) => {
                        if (err) {
                            console.error(`Error deleting image from images table for image id ${imageId}:`, err);
                            return reject(err);
                        }

                        console.log(`Deleted image id ${imageId} from images table`);
                        resolve(result);
                    });
                });
            });
        });

        // Step 3: Wait for all deletions to finish, then update Storage_used
        Promise.all(deletePromises)
            .then(() => {
                db.query(
                    'UPDATE client SET Storage_used = GREATEST(0, Storage_used - ?) WHERE CustomerId = ?',
                    [totalSizeMB, clientId],
                    (err, updateResult) => {
                        if (err) {
                            console.error(`Error updating Storage_used for client ${clientId}:`, err);
                            return res.status(500).json({ error: 'Error updating storage usage' });
                        }

                        console.log(`Subtracted ${totalSizeMB} MB from Storage_used for client ${clientId}`);
                        res.json({ message: 'Images deleted successfully' });
                    }
                );
            })
            .catch((err) => {
                console.error('Error deleting images:', err);
                res.status(500).json({ error: 'Error deleting images' });
            });
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
            return res.status(200).json({ message: "No images found for the selected labels" });
        }

        // Set up the response headers for a ZIP file download
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="event_${eventId}_images.zip"`);

        // Create a new ZIP archive
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression level
        });

        // Pipe the archive data to the response
        archive.pipe(res);

        // Process each image and add it to the ZIP
        Promise.all(results.map(async (r) => {
            // Optionally compress the image with sharp (remove if you want original quality)
            const compressedBuffer = await sharp(r.image)
                .jpeg({ quality: 80 }) // Adjust quality as needed (80% is a good balance)
                .toBuffer();

            // Add the image to the ZIP with a unique filename
            archive.append(compressedBuffer, { name: `image_${r.id}.jpg` });
        }))
        .then(() => {
            // Finalize the archive once all images are added
            archive.finalize();
        })
        .catch(err => {
            console.error("Error processing images for ZIP:", err);
            // If an error occurs after piping, we can't change the response, so log it
            if (!res.headersSent) {
                res.status(500).json({ error: "Error creating ZIP file" });
            }
        });

        // Handle archive errors
        archive.on('error', (err) => {
            console.error("Archive error:", err);
            if (!res.headersSent) {
                res.status(500).json({ error: "Error creating ZIP file" });
            }
        });
    });
};  