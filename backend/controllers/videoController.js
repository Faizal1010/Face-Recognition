const mysql = require('mysql2');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // Added for generating unique video_id

// Set up multer with a 4 GB file size limit
const upload = multer({ 
    storage: multer.diskStorage({
        destination: 'uploads/',
        filename: (req, file, cb) => {
            cb(null, `${Date.now()}-${file.originalname}`);
        }
    }),
    limits: { fileSize: 4 * 1024 * 1024 * 1024 } // 4 GB
});

// DB Connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'zxcvbnm1010@',
    database: 'face_recognition',
    connectionLimit: 10
});

// Handler to store videos
exports.storeVideos = [
    upload.fields([
        { name: 'video', maxCount: 10 },
        { name: 'thumbnail', maxCount: 1 }
    ]),
    (req, res) => {
        const { client_id, event_code, label } = req.body;
        const videos = req.files['video'];
        const thumbnail = req.files['thumbnail'] ? req.files['thumbnail'][0] : null;

        console.log("Request body:", req.body);
        console.log("Uploaded video files:", videos);
        console.log("Uploaded thumbnail:", thumbnail);

        // Function to clean up all temporary files
        const cleanupFiles = () => {
            videos.forEach(file => {
                try {
                    fs.unlinkSync(file.path);
                } catch (unlinkErr) {
                    console.error(`Error deleting temp file ${file.path}:`, unlinkErr);
                }
            });
            if (thumbnail) {
                try {
                    fs.unlinkSync(thumbnail.path);
                } catch (unlinkErr) {
                    console.error(`Error deleting temp thumbnail ${thumbnail.path}:`, unlinkErr);
                }
            }
        };

        if (!client_id || !event_code || !videos || videos.length === 0) {
            cleanupFiles();
            return res.status(400).json({ error: 'client_id, event_code, and video files are required' });
        }

        console.log("Storing videos with:");
        console.log("client_id:", client_id);
        console.log("event_code:", event_code);
        console.log("label:", label);
        console.log("Number of videos:", videos.length);

        const totalSizeMB = videos.reduce((total, video) => total + (video.size / (1024 * 1024)), 0) +
                           (thumbnail ? thumbnail.size / (1024 * 1024) : 0);

        let thumbnailData = null;
        if (thumbnail) {
            try {
                thumbnailData = fs.readFileSync(thumbnail.path);
            } catch (err) {
                console.error('Error reading thumbnail file:', err);
                cleanupFiles();
                return res.status(500).json({ error: 'Error reading thumbnail file' });
            }
        }

        db.query(
            'SELECT Storage_limit, Storage_used, Expiry_date FROM client WHERE CustomerId = ?',
            [client_id],
            (err, result) => {
                if (err) {
                    console.error('Error checking storage limit and expiry date:', err);
                    cleanupFiles();
                    return res.status(500).json({ error: 'Error checking storage limit and expiry date' });
                }
                if (result.length === 0) {
                    cleanupFiles();
                    return res.status(404).json({ error: 'Client not found' });
                }
                const { Storage_limit, Storage_used, Expiry_date } = result[0];

                const currentDate = new Date();
                if (Expiry_date && Expiry_date < currentDate) {
                    cleanupFiles();
                    return res.status(400).json({ error: 'The plan has expired. Please renew.' });
                }

                if (Storage_used + totalSizeMB > Storage_limit) {
                    const spaceLeft = Storage_limit - Storage_used;
                    cleanupFiles();
                    return res.status(400).json({
                        error: `Videos were not uploaded. You only have ${spaceLeft.toFixed(2)} MB left. Please upgrade or upload within left space.`
                    });
                }

                const insertPromises = videos.map((file) => {
                    return new Promise((resolve, reject) => {
                        const filePath = file.path;
                        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
                        console.log(`Processing video: ${file.originalname} (${fileSizeMB} MB)`);

                        const chunkSize = 10 * 1024 * 1024;
                        const stream = fs.createReadStream(filePath, { highWaterMark: chunkSize });
                        const chunks = [];
                        const videoId = uuidv4();
                        stream.on('data', (chunk) => chunks.push(chunk));
                        stream.on('end', () => {
                            const totalChunks = chunks.length;
                            console.log(`Total chunks for ${file.originalname}: ${totalChunks}`);

                            db.beginTransaction((err) => {
                                if (err) {
                                    console.error('Error starting transaction:', err);
                                    return reject(err);
                                }

                                const chunkPromises = chunks.map((chunk, index) => {
                                    return new Promise((resolveChunk, rejectChunk) => {
                                        console.log(`Storing chunk ${index + 1} of ${totalChunks}, size: ${chunk.length} bytes`);
                                        const query = 'INSERT INTO videos (video_id, chunk, chunk_index, total_chunks, client_id, event_code, label, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
                                        const params = [
                                            videoId,
                                            chunk,
                                            index,
                                            totalChunks,
                                            client_id,
                                            event_code,
                                            label,
                                            index === 0 ? thumbnailData : null
                                        ];
                                        db.execute(query, params, (err, result) => {
                                            if (err) {
                                                console.error(`Error storing chunk ${index + 1} of ${file.originalname}:`, err);
                                                return rejectChunk(err);
                                            }
                                            resolveChunk(result.insertId);
                                        });
                                    });
                                });

                                Promise.all(chunkPromises)
                                    .then((chunkIds) => {
                                        db.commit((commitErr) => {
                                            if (commitErr) {
                                                console.error('Error committing transaction:', commitErr);
                                                return db.rollback(() => reject(commitErr));
                                            }

                                            fs.unlink(filePath, (unlinkErr) => {
                                                if (unlinkErr) console.error(`Error deleting temp file ${filePath}:`, unlinkErr);
                                            });
                                            resolve(chunkIds[0]);
                                        });
                                    })
                                    .catch((chunkErr) => {
                                        db.rollback(() => {
                                            console.error('Rolling back transaction due to error:', chunkErr);
                                            reject(chunkErr);
                                        });
                                    });
                            });
                        });
                        stream.on('error', (err) => {
                            console.error(`Error reading file ${file.originalname}:`, err);
                            reject(err);
                        });
                    });
                });

                Promise.all(insertPromises)
                    .then((insertedIds) => {
                        if (thumbnail) {
                            fs.unlink(thumbnail.path, (unlinkErr) => {
                                if (unlinkErr) console.error(`Error deleting temp thumbnail ${thumbnail.path}:`, unlinkErr);
                            });
                        }

                        db.query(
                            'UPDATE client SET Storage_used = LEAST(Storage_limit, Storage_used + ?) WHERE CustomerId = ?',
                            [totalSizeMB, client_id],
                            (updateErr) => {
                                if (updateErr) {
                                    console.error('Error updating Storage_used:', updateErr);
                                    cleanupFiles();
                                    return res.status(500).json({ error: 'Error updating storage usage' });
                                }
                                console.log(`Added ${totalSizeMB} MB to Storage_used for client ${client_id}`);
                                console.log(`Successfully stored ${insertedIds.length} video(s) with IDs:`, insertedIds);
                                res.json({
                                    data: JSON.stringify({ status: 'completed' }),
                                    message: 'Videos stored successfully',
                                    videoIds: insertedIds,
                                    affectedRows: insertedIds.length
                                });
                            }
                        );
                    })
                    .catch((err) => {
                        cleanupFiles();
                        console.error('Error storing videos:', err);
                        res.status(500).json({ error: 'Error storing videos' });
                    });
            }
        );
    }
];

// Get videos handler updated to use video_id
exports.getVideos = (req, res) => {
    console.log('hit');
    const { client_id, event_code, label, video_id } = req.query; // Added video_id as an optional parameter

    if (!client_id || !event_code || !label) {
        return res.status(400).json({ error: 'client_id, event_code, and label are required' });
    }

    let query = 'SELECT chunk, chunk_index, total_chunks, thumbnail FROM videos WHERE client_id = ? AND event_code = ? AND label = ?';
    let params = [client_id, event_code, label];
    
    if (video_id) {
        query += ' AND video_id = ?'; // Filter by video_id if provided
        params.push(video_id);
    }
    
    query += ' ORDER BY chunk_index ASC';

    db.query(query, params, (err, results) => {
        if (err) {
            console.error('Error retrieving video chunks:', err);
            return res.status(500).json({ error: 'Error retrieving video' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const totalChunks = results[0].total_chunks;
        if (results.length !== totalChunks) {
            console.error(`Incomplete video: expected ${totalChunks} chunks, found ${results.length}`);
            return res.status(500).json({ error: 'Incomplete video data' });
        }

        // Prepare response with thumbnail as base64 (only from the first chunk where it exists)
        const videoData = {
            id: results[0].id, // Assuming you have an ID field; adjust if needed
            client_id,
            event_code,
            label,
            thumbnail: results[0].thumbnail ? Buffer.from(results[0].thumbnail).toString('base64') : null
        };

        // If the request is for JSON data (e.g., for display), return it
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.json({
                videos: [videoData],
                page: 1,
                totalPages: 1,
                total: results.length
            });
        }

        // Otherwise, stream the video (original behavior)
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${client_id}-${event_code}-${label}.mp4"`);

        let currentChunk = 0;
        const streamChunk = () => {
            if (currentChunk >= results.length) {
                res.end();
                return;
            }

            const chunkBuffer = results[currentChunk].chunk;
            res.write(chunkBuffer, (err) => {
                if (err) {
                    console.error('Error streaming chunk:', err);
                    res.status(500).end();
                    return;
                }
                currentChunk++;
                streamChunk();
            });
        };

        streamChunk();
    });
};

// Delete videos by label and event_code
exports.deleteVideo = (req, res) => {
    const { label, event_code } = req.body;

    if (!label || !event_code) {
        return res.status(400).json({ error: 'Both label and event_code are required' });
    }

    console.log("Deleting videos with labels:", label);
    console.log("For event_code:", event_code);

    const deletePromises = label.map((singleLabel) => {
        return new Promise((resolve, reject) => {
            const selectQuery = `
                SELECT video_id, client_id, 
                       SUM(LENGTH(chunk)) as total_size, 
                       MAX(LENGTH(thumbnail)) as thumbnail_size 
                FROM videos 
                WHERE event_code = ? AND label = ? 
                GROUP BY video_id, client_id`;
            db.query(selectQuery, [event_code, singleLabel], (err, results) => {
                if (err) {
                    console.error(`Error fetching video_ids for label "${singleLabel}":`, err);
                    return reject(err);
                }

                if (results.length === 0) {
                    console.log(`No videos found for label "${singleLabel}" and event_code "${event_code}"`);
                    return resolve();
                }

                const videoIds = results.map(r => r.video_id);
                const totalSizeMB = results.reduce((total, r) => {
                    const videoSize = r.total_size / (1024 * 1024);
                    const thumbSize = r.thumbnail_size ? r.thumbnail_size / (1024 * 1024) : 0;
                    return total + videoSize + thumbSize;
                }, 0);
                const clientId = results[0].client_id;

                const deleteQuery = 'DELETE FROM videos WHERE video_id IN (?)';
                db.query(deleteQuery, [videoIds], (err, result) => {
                    if (err) {
                        console.error(`Error deleting videos for label "${singleLabel}":`, err);
                        return reject(err);
                    }
                    console.log(`Deleted ${result.affectedRows} chunks for label "${singleLabel}"`);

                    // Update Storage_used
                    db.query(
                        'UPDATE client SET Storage_used = GREATEST(0, Storage_used - ?) WHERE CustomerId = ?',
                        [totalSizeMB, clientId],
                        (updateErr) => {
                            if (updateErr) {
                                console.error(`Error updating Storage_used for client ${clientId}:`, updateErr);
                                return reject(updateErr);
                            }
                            console.log(`Subtracted ${totalSizeMB} MB from Storage_used for client ${clientId}`);
                            resolve(result);
                        }
                    );
                });
            });
        });
    });

    Promise.all(deletePromises)
        .then(() => res.json({ message: 'Videos deleted successfully' }))
        .catch(err => {
            console.error('Error deleting videos:', err);
            res.status(500).json({ error: 'Error deleting videos' });
        });
};

// Get labels for videos by eventId
exports.getVideoLabels = (req, res) => {
    const eventId = req.params.eventId;

    if (!eventId) {
        return res.status(400).json({ error: 'eventId is required' });
    }

    db.query('SELECT label FROM videos WHERE event_code = ?', [eventId], (err, results) => {
        if (err) {
            console.error('Error fetching video labels:', err);
            return res.status(500).json({ error: 'Error fetching video labels' });
        }

        const labels = results.map(r => r.label);
        res.json(labels);
    });
};

// Update video labels
exports.updateVideoLabels = (req, res) => {
    const { label, newLabel, event_code } = req.body;

    if (!label || !newLabel || !event_code) {
        return res.status(400).json({ error: 'label, newLabel, and event_code are required' });
    }

    console.log("label:", label);
    console.log("newLabel:", newLabel);
    console.log("event_code:", event_code);

    const updatePromises = label.map((singleLabel) => {
        return new Promise((resolve, reject) => {
            const selectQuery = 'SELECT id FROM videos WHERE event_code = ? AND label = ?';
            db.query(selectQuery, [event_code, singleLabel], (err, results) => {
                if (err) {
                    console.error(`Error fetching videos for label "${singleLabel}":`, err);
                    return reject(err);
                }

                if (results.length === 0) {
                    console.log(`No videos found for label "${singleLabel}" and event_code "${event_code}"`);
                    return resolve();
                }

                const updateQuery = 'UPDATE videos SET label = ? WHERE id = ?';
                const updatePromisesForLabel = results.map(video => {
                    return new Promise((resolve, reject) => {
                        db.query(updateQuery, [newLabel, video.id], (err, updateResult) => {
                            if (err) return reject(err);
                            resolve(updateResult);
                        });
                    });
                });

                Promise.all(updatePromisesForLabel)
                    .then(() => resolve())
                    .catch(reject);
            });
        });
    });

    Promise.all(updatePromises)
        .then(() => res.json({ message: 'Video labels updated successfully' }))
        .catch(err => {
            console.error('Error updating video labels:', err);
            res.status(500).json({ error: 'Error updating video labels' });
        });
};

// Delete selected videos by IDs
// exports.deleteSelectedVideos = (req, res) => {
//     const { videoIds } = req.body;

//     if (!videoIds || !Array.isArray(videoIds) || videoIds.length === 0) {
//         return res.status(400).json({ error: 'No video IDs provided' });
//     }

//     console.log("Deleting all chunks for videos with IDs:", videoIds);

//     const selectQuery = `
//         SELECT video_id, client_id, 
//                SUM(LENGTH(chunk)) as total_size, 
//                MAX(LENGTH(thumbnail)) as thumbnail_size 
//         FROM videos 
//         WHERE id IN (?) 
//         GROUP BY video_id, client_id`;
//     db.query(selectQuery, [videoIds], (err, results) => {
//         if (err) {
//             console.error('Error fetching video_ids:', err);
//             return res.status(500).json({ error: 'Error fetching video_ids' });
//         }

//         if (results.length === 0) {
//             console.log('No videos found for the provided IDs');
//             return res.json({ message: 'No videos found to delete' });
//         }

//         const videoIdList = results.map(r => r.video_id);
//         const totalSizeMB = results.reduce((total, r) => {
//             const videoSize = r.total_size / (1024 * 1024);
//             const thumbSize = r.thumbnail_size ? r.thumbnail_size / (1024 * 1024) : 0;
//             return total + videoSize + thumbSize;
//         }, 0);
//         const clientId = results[0].client_id;

//         const deleteQuery = 'DELETE FROM videos WHERE video_id IN (?)';
//         db.query(deleteQuery, [videoIdList], (err, result) => {
//             if (err) {
//                 console.error('Error deleting video chunks:', err);
//                 return res.status(500).json({ error: 'Error deleting videos' });
//             }
//             console.log(`Deleted ${result.affectedRows} chunks for video IDs:`, videoIds);

//             // Update Storage_used
//             db.query(
//                 'UPDATE client SET Storage_used = GREATEST(0, Storage_used - ?) WHERE CustomerId = ?',
//                 [totalSizeMB, clientId],
//                 (updateErr) => {
//                     if (updateErr) {
//                         console.error(`Error updating Storage_used for client ${clientId}:`, updateErr);
//                         return res.status(500).json({ error: 'Error updating storage usage' });
//                     }
//                     console.log(`Subtracted ${totalSizeMB} MB from Storage_used for client ${clientId}`);
//                     res.json({ message: 'Videos deleted successfully', affectedRows: result.affectedRows });
//                 }
//             );
//         });
//     });
// };

// Get videos by labels (Updated to include video_id and fix pagination)
exports.getVideosByLabels = (req, res) => {
    const { labels, page, limit, eventId } = req.body;
    console.log("Selected Event ID from getVideosByLabels:", eventId);

    if (!labels || labels.length === 0) {
        return res.status(400).json({ error: "No labels provided" });
    }

    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;
    const offset = (pageNum - 1) * pageSize;

    // Fetch only the first chunk (chunk_index = 0) for each video with the actual thumbnail and video_id
    const query = `
        SELECT v.id, v.video_id, v.thumbnail, v.client_id, v.event_code, v.label
        FROM videos v
        WHERE FIND_IN_SET(v.label, ?) AND v.event_code = ? AND v.chunk_index = 0
        ORDER BY v.id ASC
        LIMIT ? OFFSET ?`;
    db.query(query, [labels.join(','), eventId, pageSize, offset], (err, results) => {
        if (err) {
            console.error("Error fetching videos by labels:", err);
            return res.status(500).json({ error: "Error fetching videos" });
        }

        const videos = results.map(r => ({
            id: r.id,
            video_id: r.video_id, // Include video_id in the response
            thumbnail: r.thumbnail ? Buffer.from(r.thumbnail).toString('base64') : null,
            client_id: r.client_id,
            event_code: r.event_code,
            label: r.label
        }));

        // Count distinct video_id (not chunks) for pagination
        const countQuery = `
            SELECT COUNT(DISTINCT v.video_id) AS total 
            FROM videos v 
            WHERE FIND_IN_SET(v.label, ?) AND v.event_code = ? AND v.chunk_index = 0`;
        db.query(countQuery, [labels.join(','), eventId], (err, countResult) => {
            if (err) {
                console.error("Error fetching total count:", err);
                return res.status(500).json({ error: "Error fetching total count" });
            }

            const total = countResult[0].total;
            const totalPages = Math.ceil(total / pageSize);

            res.json({ videos, page: pageNum, totalPages, total });
        });
    });
};

// Delete videos by IDs
exports.deleteVideosByIds = (req, res) => {
    const { videoIds } = req.body;

    if (!Array.isArray(videoIds) || videoIds.length === 0) {
        return res.status(400).json({ error: 'An array of video IDs is required' });
    }

    console.log("Deleting videos with IDs:", videoIds);

    // Step 1: Get the video_id(s) associated with the provided id(s)
    const getVideoIdsQuery = 'SELECT DISTINCT video_id FROM videos WHERE id IN (?)';
    db.query(getVideoIdsQuery, [videoIds], (err, videoIdResults) => {
        if (err) {
            console.error('Error fetching video_ids:', err);
            return res.status(500).json({ error: 'Error fetching video_ids' });
        }

        if (videoIdResults.length === 0) {
            console.log('No videos found for the provided IDs');
            return res.json({ message: 'No videos found to delete' });
        }

        const videoIdList = videoIdResults.map(r => r.video_id);

        // Step 2: Get the total size of all chunks for the video_id(s)
        const selectQuery = `
            SELECT video_id, client_id, 
                   SUM(LENGTH(chunk)) as total_size, 
                   MAX(LENGTH(thumbnail)) as thumbnail_size 
            FROM videos 
            WHERE video_id IN (?) 
            GROUP BY video_id, client_id`;
        db.query(selectQuery, [videoIdList], (err, results) => {
            if (err) {
                console.error('Error fetching video sizes:', err);
                return res.status(500).json({ error: 'Error fetching video sizes' });
            }

            if (results.length === 0) {
                console.log('No videos found for the provided video_ids');
                return res.json({ message: 'No videos found to delete' });
            }

            const totalSizeMB = results.reduce((total, r) => {
                const videoSize = r.total_size / (1024 * 1024);
                const thumbSize = r.thumbnail_size ? r.thumbnail_size / (1024 * 1024) : 0;
                return total + videoSize + thumbSize;
            }, 0);
            const clientId = results[0].client_id;

            const deleteQuery = 'DELETE FROM videos WHERE video_id IN (?)';
            db.query(deleteQuery, [videoIdList], (err, result) => {
                if (err) {
                    console.error('Error deleting video chunks:', err);
                    return res.status(500).json({ error: 'Error deleting videos' });
                }
                console.log(`Deleted ${result.affectedRows} chunks for video IDs:`, videoIds);

                // Update Storage_used
                db.query(
                    'UPDATE client SET Storage_used = GREATEST(0, Storage_used - ?) WHERE CustomerId = ?',
                    [totalSizeMB, clientId],
                    (updateErr) => {
                        if (updateErr) {
                            console.error(`Error updating Storage_used for client ${clientId}:`, updateErr);
                            return res.status(500).json({ error: 'Error updating storage usage' });
                        }
                        console.log(`Subtracted ${totalSizeMB} MB from Storage_used for client ${clientId}`);
                        res.json({ message: 'Videos deleted successfully', affectedRows: result.affectedRows });
                    }
                );
            });
        });
    });
};

// Update video labels by ID
exports.updateVideoLabelsById = (req, res) => {
    const { newLabel, videoIds } = req.body;

    console.log("Received videoIds:", videoIds);

    if (!newLabel || !Array.isArray(videoIds) || videoIds.length === 0) {
        return res.status(400).json({ error: 'newLabel and an array of video IDs are required' });
    }

    console.log("Updating all chunks for videos with IDs:", videoIds, "to new label:", newLabel);

    // First get all video IDs that share the same original video (assuming chunks share a common identifier)
    // I'm assuming your table has some way to group chunks of the same video, like a video_id or event_code
    // I'll use video_id as the column that groups chunks of the same video
    const placeholders = videoIds.map(() => '?').join(',');
    const selectQuery = `SELECT DISTINCT video_id FROM videos WHERE id IN (${placeholders})`;
    
    db.query(selectQuery, videoIds, (err, results) => {
        if (err) {
            console.error('Error fetching video IDs:', err);
            return res.status(500).json({ error: 'Error fetching video IDs' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'No videos found for provided IDs' });
        }

        // Extract all unique video_ids that group the chunks
        const videoGroupIds = results.map(row => row.video_id);
        const updatePlaceholders = videoGroupIds.map(() => '?').join(',');
        
        // Update all chunks that belong to these videos
        const updateQuery = `UPDATE videos SET label = ? WHERE video_id IN (${updatePlaceholders})`;
        
        db.query(updateQuery, [newLabel, ...videoGroupIds], (err, result) => {
            if (err) {
                console.error('Error updating labels for video chunks:', err);
                return res.status(500).json({ error: 'Error updating video labels' });
            }

            console.log(`Updated ${result.affectedRows} chunks to label "${newLabel}" for video IDs:`, videoIds);
            res.json({ message: 'Video labels updated successfully', affectedRows: result.affectedRows });
        });
    });
};

// Get original video by ID
exports.getOriginalVideo = (req, res) => {
    const { id } = req.params;
    console.log("Fetching original video with ID:", id);

    const query = 'SELECT video FROM videos WHERE id = ?';
    db.query(query, [id], (err, results) => {
        if (err) {
            console.error("Error fetching original video:", err);
            return res.status(500).json({ error: "Error fetching original video" });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: "Video not found" });
        }

        const videoBuffer = results[0].video;
        res.set('Content-Type', 'video/mp4'); // Assuming MP4 format; adjust if needed
        res.set('Content-Disposition', `attachment; filename="video_${id}.mp4"`);
        res.send(videoBuffer);
    });
};

// Download all selected videos
exports.downloadAllSelectedVideos = (req, res) => {
    const { labels, eventId } = req.body;
    console.log("Selected Labels and Event ID for download:", labels, eventId);

    if (!labels || labels.length === 0 || !eventId) {
        return res.status(400).json({ error: "Labels and eventId are required" });
    }

    const query = 'SELECT id, video FROM videos WHERE FIND_IN_SET(label, ?) AND event_code = ? ORDER BY id ASC';
    db.query(query, [labels.join(','), eventId], (err, results) => {
        if (err) {
            console.error("Error fetching videos for download:", err);
            return res.status(500).json({ error: "Error fetching videos" });
        }

        if (results.length === 0) {
            return res.status(200).json({ videos: [] });
        }

        const videos = results.map(r => ({
            id: r.id,
            data: Buffer.from(r.video).toString('base64')
        }));

        res.json({ videos });
    });
};

// fetching all videos without client id (same as getVideos handler just without client_id)
exports.getVideosNoClient = (req, res) => {
    console.log('hit');
    const { event_code, label, video_id } = req.query; // Removed client_id

    if (!event_code || !label) {
        return res.status(400).json({ error: 'event_code and label are required' });
    }

    let query = 'SELECT chunk, chunk_index, total_chunks, thumbnail FROM videos WHERE event_code = ? AND label = ?';
    let params = [event_code, label];
    
    if (video_id) {
        query += ' AND video_id = ?'; // Filter by video_id if provided
        params.push(video_id);
    }
    
    query += ' ORDER BY chunk_index ASC';

    db.query(query, params, (err, results) => {
        if (err) {
            console.error('Error retrieving video chunks:', err);
            return res.status(500).json({ error: 'Error retrieving video' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const totalChunks = results[0].total_chunks;
        if (results.length !== totalChunks) {
            console.error(`Incomplete video: expected ${totalChunks} chunks, found ${results.length}`);
            return res.status(500).json({ error: 'Incomplete video data' });
        }

        // Prepare response with thumbnail as base64 (only from the first chunk where it exists)
        const videoData = {
            id: results[0].id, // Assuming you have an ID field; adjust if needed
            event_code,
            label,
            thumbnail: results[0].thumbnail ? Buffer.from(results[0].thumbnail).toString('base64') : null
        };

        // If the request is for JSON data (e.g., for display), return it
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.json({
                videos: [videoData],
                page: 1,
                totalPages: 1,
                total: results.length
            });
        }

        // Otherwise, stream the video (original behavior)
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${event_code}-${label}.mp4"`);

        let currentChunk = 0;
        const streamChunk = () => {
            if (currentChunk >= results.length) {
                res.end();
                return;
            }

            const chunkBuffer = results[currentChunk].chunk;
            res.write(chunkBuffer, (err) => {
                if (err) {
                    console.error('Error streaming chunk:', err);
                    res.status(500).end();
                    return;
                }
                currentChunk++;
                streamChunk();
            });
        };

        streamChunk();
    });
};