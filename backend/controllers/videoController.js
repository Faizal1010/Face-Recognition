const mysql = require('mysql2');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');

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
        { name: 'video', maxCount: 30 },
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
        const cleanupFiles = (files) => {
            files.forEach(file => {
                try {
                    if (fs.existsSync(file)) fs.unlinkSync(file);
                } catch (unlinkErr) {
                    console.error(`Error deleting temp file ${file}:`, unlinkErr);
                }
            });
        };

        if (!client_id || !event_code || !videos || videos.length === 0) {
            cleanupFiles(videos.map(file => file.path));
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
                cleanupFiles(videos.map(file => file.path).concat([thumbnail.path]));
                return res.status(500).json({ error: 'Error reading thumbnail file' });
            }
        }

        db.query(
            'SELECT Storage_limit, Storage_used, Expiry_date FROM client WHERE CustomerId = ?',
            [client_id],
            (err, result) => {
                if (err) {
                    console.error('Error checking storage limit and expiry date:', err);
                    cleanupFiles(videos.map(file => file.path).concat(thumbnail ? [thumbnail.path] : []));
                    return res.status(500).json({ error: 'Error checking storage limit and expiry date' });
                }
                if (result.length === 0) {
                    cleanupFiles(videos.map(file => file.path).concat(thumbnail ? [thumbnail.path] : []));
                    return res.status(404).json({ error: 'Client not found' });
                }
                const { Storage_limit, Storage_used, Expiry_date } = result[0];

                const currentDate = new Date();
                if (Expiry_date && Expiry_date < currentDate) {
                    cleanupFiles(videos.map(file => file.path).concat(thumbnail ? [thumbnail.path] : []));
                    return res.status(400).json({ error: 'The plan has expired. Please renew.' });
                }

                if (Storage_used + totalSizeMB > Storage_limit) {
                    const spaceLeft = Storage_limit - Storage_used;
                    cleanupFiles(videos.map(file => file.path).concat(thumbnail ? [thumbnail.path] : []));
                    return res.status(400).json({
                        error: `Videos were not uploaded. You only have ${spaceLeft.toFixed(2)} MB left. Please upgrade or upload within left space.`
                    });
                }

                const videoDir = path.join('videos', event_code);
                if (!fs.existsSync(videoDir)) {
                    fs.mkdirSync(videoDir, { recursive: true });
                }

                const insertPromises = videos.map((file) => {
                    return new Promise((resolve, reject) => {
                        const videoId = uuidv4();
                        const uniqueFilename = `${videoId}.mp4`; // Assuming MP4 format
                        const finalPath = path.join(videoDir, uniqueFilename);
                        const tempProcessedPath = path.join('uploads', `processed-${uniqueFilename}`);

                        // Preprocess video with FFmpeg to ensure MOOV atom is at the start
                        const ffmpeg = spawn('ffmpeg', [
                            '-i', file.path,
                            '-c:v', 'copy', // Copy video stream without re-encoding
                            '-c:a', 'copy', // Copy audio stream without re-encoding
                            '-movflags', 'faststart', // Place MOOV atom at start
                            '-f', 'mp4',
                            tempProcessedPath
                        ]);

                        let ffmpegError = '';
                        ffmpeg.stderr.on('data', (data) => {
                            ffmpegError += data.toString();
                        });

                        ffmpeg.on('close', (code) => {
                            if (code !== 0) {
                                console.error(`FFmpeg preprocessing failed for ${file.originalname}:`, ffmpegError);
                                cleanupFiles([file.path, tempProcessedPath]);
                                return reject(new Error(`FFmpeg preprocessing failed: ${ffmpegError}`));
                            }

                            // Move preprocessed file to final destination
                            fs.rename(tempProcessedPath, finalPath, (err) => {
                                if (err) {
                                    console.error(`Error moving preprocessed file ${tempProcessedPath} to ${finalPath}:`, err);
                                    cleanupFiles([file.path, tempProcessedPath]);
                                    return reject(err);
                                }

                                // Delete original temp file
                                fs.unlink(file.path, (unlinkErr) => {
                                    if (unlinkErr) console.error(`Error deleting temp file ${file.path}:`, unlinkErr);
                                });

                                const fileSizeMB = (fs.statSync(finalPath).size / (1024 * 1024)).toFixed(2);
                                console.log(`Stored video: ${uniqueFilename} (${fileSizeMB} MB)`);

                                const query = 'INSERT INTO videos (video_id, filename, client_id, event_code, label, thumbnail) VALUES (?, ?, ?, ?, ?, ?)';
                                const params = [videoId, uniqueFilename, client_id, event_code, label || null, thumbnailData];

                                db.execute(query, params, (err, result) => {
                                    if (err) {
                                        console.error(`Error storing video metadata for ${uniqueFilename}:`, err);
                                        fs.unlinkSync(finalPath); // Remove file if DB insert fails
                                        cleanupFiles([tempProcessedPath]);
                                        return reject(err);
                                    }
                                    resolve(result.insertId);
                                });
                            });
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
                                    cleanupFiles(videos.map(file => path.join(videoDir, `${file.videoId}.mp4`)));
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
                        cleanupFiles(videos.map(file => file.path).concat(thumbnail ? [thumbnail.path] : []));
                        console.error('Error storing videos:', err);
                        res.status(500).json({ error: 'Error storing videos' });
                    });
            }
        );
    }
];

// Get videos handler to stream video directly
exports.getVideos = (req, res) => {
    console.log('hit');
    const { client_id, event_code, label, video_id } = req.query;

    if (!client_id || !event_code || !label) {
        return res.status(400).json({ error: 'client_id, event_code, and label are required' });
    }

    let query = 'SELECT id, video_id, filename, thumbnail FROM videos WHERE client_id = ? AND event_code = ? AND label = ?';
    let params = [client_id, event_code, label];
    
    if (video_id) {
        query += ' AND video_id = ?';
        params.push(video_id);
    }

    db.query(query, params, (err, results) => {
        if (err) {
            console.error('Error retrieving video metadata:', err);
            return res.status(500).json({ error: 'Error retrieving video' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const { id, video_id, filename, thumbnail } = results[0];
        const videoPath = path.join('videos', event_code, filename);

        if (!fs.existsSync(videoPath)) {
            return res.status(404).json({ error: 'Video file not found on server' });
        }

        // If the request is for JSON data (e.g., for thumbnail display), return metadata
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            const videoData = {
                id,
                video_id,
                client_id,
                event_code,
                label,
                thumbnail: thumbnail ? Buffer.from(thumbnail).toString('base64') : null
            };
            return res.json({
                videos: [videoData],
                page: 1,
                totalPages: 1,
                total: results.length
            });
        }

        // Stream video directly with range request support
        const stat = fs.statSync(videoPath);
        const fileSize = stat.size;
        const range = req.headers.range;

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${client_id}-${event_code}-${label}.mp4"`);
        res.setHeader('Accept-Ranges', 'bytes');

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;

            res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
            res.setHeader('Content-Length', chunkSize);
            res.status(206); // Partial content

            const stream = fs.createReadStream(videoPath, { start, end });
            stream.pipe(res);

            stream.on('error', (err) => {
                console.error('Stream error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error streaming video' });
                }
            });

            req.on('close', () => {
                stream.destroy();
            });
        } else {
            res.setHeader('Content-Length', fileSize);
            const stream = fs.createReadStream(videoPath);
            stream.pipe(res);

            stream.on('error', (err) => {
                console.error('Stream error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error streaming video' });
                }
            });

            req.on('close', () => {
                stream.destroy();
            });
        }
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
                SELECT id, filename, client_id, 
                       SUM(LENGTH(thumbnail)) as thumbnail_size 
                FROM videos 
                WHERE event_code = ? AND label = ? 
                GROUP BY id, filename, client_id`;
            db.query(selectQuery, [event_code, singleLabel], (err, results) => {
                if (err) {
                    console.error(`Error fetching video metadata for label "${singleLabel}":`, err);
                    return reject(err);
                }

                if (results.length === 0) {
                    console.log(`No videos found for label "${singleLabel}" and event_code "${event_code}"`);
                    return resolve();
                }

                const ids = results.map(r => r.id);
                const filenames = results.map(r => r.filename);
                const totalSizeMB = results.reduce((total, r) => {
                    const filePath = path.join('videos', event_code, r.filename);
                    const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : { size: 0 };
                    const videoSize = stats.size / (1024 * 1024);
                    const thumbSize = r.thumbnail_size ? r.thumbnail_size / (1024 * 1024) : 0;
                    return total + videoSize + thumbSize;
                }, 0);
                const clientId = results[0].client_id;

                const deleteQuery = 'DELETE FROM videos WHERE id IN (?)';
                db.query(deleteQuery, [ids], (err, result) => {
                    if (err) {
                        console.error(`Error deleting videos for label "${singleLabel}":`, err);
                        return reject(err);
                    }
                    console.log(`Deleted ${result.affectedRows} videos for label "${singleLabel}"`);

                    // Delete video files from filesystem
                    filenames.forEach(filename => {
                        const filePath = path.join('videos', event_code, filename);
                        if (fs.existsSync(filePath)) {
                            fs.unlink(filePath, (unlinkErr) => {
                                if (unlinkErr) console.error(`Error deleting file ${filePath}:`, unlinkErr);
                            });
                        }
                    });

                    // Check and delete folder if empty
                    const videoDir = path.join('videos', event_code);
                    if (fs.existsSync(videoDir)) {
                        fs.readdir(videoDir, (err, files) => {
                            if (err) {
                                console.error(`Error reading directory ${videoDir}:`, err);
                                return reject(err);
                            }
                            // Only delete if directory is empty (no files or subdirectories)
                            if (files.length === 0) {
                                fs.rmdir(videoDir, (rmErr) => {
                                    if (rmErr) console.error(`Error deleting directory ${videoDir}:`, rmErr);
                                    else console.log(`Deleted empty directory ${videoDir}`);
                                });
                            }
                        });
                    }

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

    db.query('SELECT DISTINCT label FROM videos WHERE event_code = ?', [eventId], (err, results) => {
        if (err) {
            console.error('Error fetching video labels:', err);
            return res.status(500).json({ error: 'Error fetching video labels' });
        }

        const labels = results.map(r => r.label).filter(label => label); // Filter out null labels
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
                            if (err) {
                                console.error(`Error updating video ${video.id} to label "${newLabel}":`, err);
                                return reject(err);
                            }
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

// Get videos by labels
exports.getVideosByLabels = (req, res) => {
    const { labels, page, limit, eventId } = req.body;
    console.log("Selected Event ID from getVideosByLabels:", eventId);

    if (!labels || labels.length === 0) {
        return res.status(400).json({ error: "No labels provided" });
    }

    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;
    const offset = (pageNum - 1) * pageSize;

    const query = `
        SELECT id, video_id, filename, thumbnail, client_id, event_code, label
        FROM videos
        WHERE FIND_IN_SET(label, ?) AND event_code = ?
        ORDER BY id ASC
        LIMIT ? OFFSET ?`;
    db.query(query, [labels.join(','), eventId, pageSize, offset], (err, results) => {
        if (err) {
            console.error("Error fetching videos by labels:", err);
            return res.status(500).json({ error: "Error fetching videos" });
        }

        const videos = results.map(r => ({
            id: r.id,
            video_id: r.video_id,
            thumbnail: r.thumbnail ? Buffer.from(r.thumbnail).toString('base64') : null,
            client_id: r.client_id,
            event_code: r.event_code,
            label: r.label
        }));

        const countQuery = `
            SELECT COUNT(*) AS total 
            FROM videos 
            WHERE FIND_IN_SET(label, ?) AND event_code = ?`;
        db.query(countQuery, [labels.join(','), eventId], (err, countResult) => {
            if (err) {
                console.error("Error fetching total count:", err);
                return res.status(500).json({ error: "Error fetching total count" });
            }

            const total = countResult[0].total;
            const totalPages = Math.ceil(total / pageSize);

            res.json({ videos, pageNum, totalPages, total });
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

    const selectQuery = `
        SELECT id, filename, client_id, event_code, 
               SUM(LENGTH(thumbnail)) as thumbnail_size 
        FROM videos 
        WHERE id IN (?) 
        GROUP BY id, filename, client_id, event_code`;
    db.query(selectQuery, [videoIds], (err, results) => {
        if (err) {
            console.error('Error fetching video metadata:', err);
            return res.status(500).json({ error: 'Error fetching video metadata' });
        }

        if (results.length === 0) {
            console.log('No videos found for the provided IDs');
            return res.json({ message: 'No videos found to delete' });
        }

        const ids = results.map(r => r.id);
        const filenames = results.map(r => r.filename);
        const eventCodes = results.map(r => r.event_code);
        const totalSizeMB = results.reduce((total, r) => {
            const filePath = path.join('videos', r.event_code, r.filename);
            const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : { size: 0 };
            const videoSize = stats.size / (1024 * 1024);
            const thumbSize = r.thumbnail_size ? r.thumbnail_size / (1024 * 1024) : 0;
            return total + videoSize + thumbSize;
        }, 0);
        const clientId = results[0].client_id;

        const deleteQuery = 'DELETE FROM videos WHERE id IN (?)';
        db.query(deleteQuery, [ids], (err, result) => {
            if (err) {
                console.error('Error deleting videos:', err);
                return res.status(500).json({ error: 'Error deleting videos' });
            }
            console.log(`Deleted ${result.affectedRows} videos`);

            // Delete video files from filesystem
            filenames.forEach((filename, index) => {
                const filePath = path.join('videos', eventCodes[index], filename);
                if (fs.existsSync(filePath)) {
                    fs.unlink(filePath, (unlinkErr) => {
                        if (unlinkErr) console.error(`Error deleting file ${filePath}:`, unlinkErr);
                    });
                }
            });

            // Check and delete folders if empty
            const uniqueEventCodes = [...new Set(eventCodes)];
            uniqueEventCodes.forEach(eventCode => {
                const videoDir = path.join('videos', eventCode);
                if (fs.existsSync(videoDir)) {
                    fs.readdir(videoDir, (err, files) => {
                        if (err) {
                            console.error(`Error reading directory ${videoDir}:`, err);
                            return;
                        }
                        // Only delete if directory is empty (no files or subdirectories)
                        if (files.length === 0) {
                            fs.rmdir(videoDir, (rmErr) => {
                                if (rmErr) console.error(`Error deleting directory ${videoDir}:`, rmErr);
                                else console.log(`Deleted empty directory ${videoDir}`);
                            });
                        }
                    });
                }
            });

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
};

// Update video labels by ID
exports.updateVideoLabelsById = (req, res) => {
    const { newLabel, videoIds } = req.body;

    console.log("Received videoIds:", videoIds);

    if (!newLabel || !Array.isArray(videoIds) || videoIds.length === 0) {
        return res.status(400).json({ error: 'newLabel and an array of video IDs are required' });
    }

    console.log("Updating videos with IDs:", videoIds, "to new label:", newLabel);

    const updateQuery = 'UPDATE videos SET label = ? WHERE id IN (?)';
    db.query(updateQuery, [newLabel, videoIds], (err, result) => {
        if (err) {
            console.error('Error updating labels:', err);
            return res.status(500).json({ error: 'Error updating video labels' });
        }

        console.log(`Updated ${result.affectedRows} videos to label "${newLabel}"`);
        res.json({ message: 'Video labels updated successfully', affectedRows: result.affectedRows });
    });
};

// Get original video by ID
exports.getOriginalVideo = (req, res) => {
    const { id } = req.params;
    console.log("Fetching original video with ID:", id);

    const query = 'SELECT filename, event_code FROM videos WHERE id = ?';
    db.query(query, [id], (err, results) => {
        if (err) {
            console.error("Error fetching video metadata:", err);
            return res.status(500).json({ error: "Error fetching video" });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: "Video not found" });
        }

        const { filename, event_code } = results[0];
        const videoPath = path.join('videos', event_code, filename);

        if (!fs.existsSync(videoPath)) {
            return res.status(404).json({ error: 'Video file not found on server' });
        }

        // Stream video directly with range request support
        const stat = fs.statSync(videoPath);
        const fileSize = stat.size;
        const range = req.headers.range;

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="video_${id}.mp4"`);
        res.setHeader('Accept-Ranges', 'bytes');

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;

            res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
            res.setHeader('Content-Length', chunkSize);
            res.status(206); // Partial content

            const stream = fs.createReadStream(videoPath, { start, end });
            stream.pipe(res);

            stream.on('error', (err) => {
                console.error('Stream error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error streaming video' });
                }
            });

            req.on('close', () => {
                stream.destroy();
            });
        } else {
            res.setHeader('Content-Length', fileSize);
            const stream = fs.createReadStream(videoPath);
            stream.pipe(res);

            stream.on('error', (err) => {
                console.error('Stream error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error streaming video' });
                }
            });

            req.on('close', () => {
                stream.destroy();
            });
        }
    });
};

// Download all selected videos (unchanged)
exports.downloadAllSelectedVideos = (req, res) => {
    const { labels, eventId } = req.body;
    console.log("Selected Labels and Event ID for download:", labels, eventId);

    if (!labels || labels.length === 0 || !eventId) {
        return res.status(400).json({ error: "Labels and eventId are required" });
    }

    const query = 'SELECT id, filename, event_code FROM videos WHERE FIND_IN_SET(label, ?) AND event_code = ?';
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
            filename: r.filename,
            event_code: r.event_code
        }));

        res.json({ videos });
    });
};

// Fetching all videos without client id
exports.getVideosNoClient = (req, res) => {
    console.log('hit');
    const { event_code, label, video_id } = req.query;

    if (!event_code || !label) {
        return res.status(400).json({ error: 'event_code and label are required' });
    }

    let query = 'SELECT id, video_id, filename, thumbnail FROM videos WHERE event_code = ? AND label = ?';
    let params = [event_code, label];
    
    if (video_id) {
        query += ' AND video_id = ?';
        params.push(video_id);
    }

    db.query(query, params, (err, results) => {
        if (err) {
            console.error('Error retrieving video metadata:', err);
            return res.status(500).json({ error: 'Error retrieving video' });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const { id, video_id, filename, thumbnail } = results[0];
        const videoPath = path.join('videos', event_code, filename);

        if (!fs.existsSync(videoPath)) {
            return res.status(404).json({ error: 'Video file not found on server' });
        }

        // If the request is for JSON data (e.g., for thumbnail display), return metadata
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            const videoData = {
                id,
                video_id,
                event_code,
                label,
                thumbnail: thumbnail ? Buffer.from(thumbnail).toString('base64') : null
            };
            return res.json({
                videos: [videoData],
                page: 1,
                totalPages: 1,
                total: results.length
            });
        }

        // Stream video directly with range request support
        const stat = fs.statSync(videoPath);
        const fileSize = stat.size;
        const range = req.headers.range;

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${event_code}-${label}.mp4"`);
        res.setHeader('Accept-Ranges', 'bytes');

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;

            res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
            res.setHeader('Content-Length', chunkSize);
            res.status(206); // Partial content

            const stream = fs.createReadStream(videoPath, { start, end });
            stream.pipe(res);

            stream.on('error', (err) => {
                console.error('Stream error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error streaming video' });
                }
            });

            req.on('close', () => {
                stream.destroy();
            });
        } else {
            res.setHeader('Content-Length', fileSize);
            const stream = fs.createReadStream(videoPath);
            stream.pipe(res);

            stream.on('error', (err) => {
                console.error('Stream error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error streaming video' });
                }
            });

            req.on('close', () => {
                stream.destroy();
            });
        }
    });
};