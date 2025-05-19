const mysql = require('mysql2')
const fs = require('fs').promises;
const path = require('path');

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'zxcvbnm1010@',
    database: 'face_recognition'
});

// Add Event handler (using MySQL)
const addEvent = async (req, res) => {
    try {
        const { client_id, event_code, name } = req.body;

        // Validate the input
        if (!client_id || !event_code || !name) {
            return res.status(400).json({
                success: false,
                message: "Client ID, Event Code, and Event Name are required!"
            });
        }

        // Create the event record in MySQL
        const query = `
            INSERT INTO events (client_id, event_code, name)
            VALUES (?, ?, ?)`;

        const values = [client_id, event_code, name];

        db.query(query, values, (err, result) => {
            if (err) {
                console.error('Error adding event:', err);
                return res.status(500).json({
                    success: false,
                    message: "Event couldn't be added due to an internal error",
                    error: err.message,
                });
            }

            // Return the newly added event
            const newEvent = {
                client_id,
                event_code,
                name
            };

            res.status(201).json({
                success: true,
                message: "Event added successfully",
                event: newEvent
            });
        });

    } catch (error) {
        console.error('Error adding event:', error);
        res.status(500).json({
            success: false,
            message: "Event couldn't be added due to an internal error",
            error: error.message
        });
    }
};

// Get All Events handler (using MySQL)
const getAllEvents = async (req, res) => {
    try {
        const query = 'SELECT * FROM events';

        db.query(query, (err, results) => {
            if (err) {
                console.error('Error fetching events:', err);
                return res.status(500).json({
                    success: false,
                    message: "Could not retrieve events due to an internal error",
                    error: err.message
                });
            }

            // Check if there are any events
            if (results.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "No events found"
                });
            }

            // Send success response with all events
            res.status(200).json({
                success: true,
                message: "Events retrieved successfully",
                events: results
            });
        });
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({
            success: false,
            message: "Could not retrieve events due to an internal error",
            error: error.message
        });
    }
};

// Delete Event handler (using MySQL)
const deleteEvent = async (req, res) => {
    try {
        const { id } = req.params; // Extract the event ID from the URL params

        // Validate the input
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Event ID is required!"
            });
        }

        // Start a transaction
        db.beginTransaction(async (err) => {
            if (err) {
                console.error('Error starting transaction:', err);
                return res.status(500).json({
                    success: false,
                    message: "Failed to start transaction",
                    error: err.message
                });
            }

            try {
                // Step 1: Fetch the event_code and client_id for the given event ID
                const [eventResults] = await db.promise().query('SELECT event_code, client_id FROM events WHERE id = ?', [id]);
                if (eventResults.length === 0) {
                    await db.promise().rollback();
                    return res.status(404).json({
                        success: false,
                        message: "Event not found"
                    });
                }

                const { event_code, client_id } = eventResults[0];

                // Step 2: Calculate total storage to free
                let totalStorageMB = 0;

                // 2.1: Calculate storage used by videos (filesystem + thumbnails in DB)
                const [videoResults] = await db.promise().query('SELECT filename, thumbnail FROM videos WHERE event_code = ?', [event_code]);
                for (const video of videoResults) {
                    const videoPath = path.join('videos', event_code, video.filename);
                    try {
                        const stats = await fs.stat(videoPath);
                        const videoSizeMB = stats.size / (1024 * 1024); // Convert bytes to MB
                        totalStorageMB += videoSizeMB;
                    } catch (err) {
                        console.warn(`Video file ${videoPath} not found on filesystem:`, err.message);
                    }

                    // Add thumbnail size if it exists
                    if (video.thumbnail) {
                        const thumbnailSizeMB = Buffer.byteLength(video.thumbnail) / (1024 * 1024); // Convert bytes to MB
                        totalStorageMB += thumbnailSizeMB;
                    }
                }

                // 2.2: Calculate storage used by images
                const [imageResults] = await db.promise().query('SELECT image FROM images WHERE event_code = ?', [event_code]);
                for (const image of imageResults) {
                    const imageSizeMB = Buffer.byteLength(image.image) / (1024 * 1024); // Convert bytes to MB
                    totalStorageMB += imageSizeMB;
                }

                // Step 3: Delete video files from filesystem
                const videoDir = path.join('videos', event_code);
                try {
                    await fs.rm(videoDir, { recursive: true, force: true });
                    console.log(`Deleted video directory: ${videoDir}`);
                } catch (err) {
                    console.warn(`Error deleting video directory ${videoDir}:`, err.message);
                    // Continue, as the directory might not exist
                }

                // Step 4: Delete related records from imageData
                // First, get the image IDs for this event
                const [imageIds] = await db.promise().query('SELECT id FROM images WHERE event_code = ?', [event_code]);
                const imageIdList = imageIds.map(img => img.id);
                if (imageIdList.length > 0) {
                    await db.promise().query('DELETE FROM imageData WHERE image_id IN (?)', [imageIdList]);
                    console.log(`Deleted ${imageIdList.length} records from imageData`);
                }

                // Step 5: Delete records from videos, images, and carousel
                await db.promise().query('DELETE FROM videos WHERE event_code = ?', [event_code]);
                await db.promise().query('DELETE FROM images WHERE event_code = ?', [event_code]);
                await db.promise().query('DELETE FROM carousel WHERE event_code = ?', [event_code]);

                // Step 6: Delete the event from the events table
                const [deleteEventResult] = await db.promise().query('DELETE FROM events WHERE id = ?', [id]);
                if (deleteEventResult.affectedRows === 0) {
                    await db.promise().rollback();
                    return res.status(404).json({
                        success: false,
                        message: "Event not found"
                    });
                }

                // Step 7: Update Storage_used in the client table
                if (totalStorageMB > 0) {
                    await db.promise().query(
                        'UPDATE client SET Storage_used = GREATEST(0, Storage_used - ?) WHERE CustomerId = ?',
                        [totalStorageMB, client_id]
                    );
                    console.log(`Freed ${totalStorageMB.toFixed(2)} MB from client ${client_id}`);
                }

                // Step 8: Commit the transaction
                await db.promise().commit();
                res.status(200).json({
                    success: true,
                    message: "Event and all related data deleted successfully",
                    storageFreedMB: totalStorageMB.toFixed(2)
                });

            } catch (err) {
                await db.promise().rollback();
                console.error('Error during deletion:', err);
                res.status(500).json({
                    success: false,
                    message: "Failed to delete event and related data",
                    error: err.message
                });
            }
        });

    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({
            success: false,
            message: "Event couldn't be deleted due to an internal error",
            error: error.message
        });
    }
};

// Get Events by Client ID handler (using MySQL)
const getEventsByClientId = async (req, res) => {
    try {
        const { client_id } = req.params; // Extract the client_id from the URL params

        // Validate the input
        if (!client_id) {
            return res.status(400).json({
                success: false,
                message: "Client ID is required!"
            });
        }

        // Create the query to fetch events based on client_id
        const query = 'SELECT * FROM events WHERE client_id = ?';

        db.query(query, [client_id], (err, results) => {
            if (err) {
                console.error('Error fetching events for client_id:', err);
                return res.status(500).json({
                    success: false,
                    message: "Could not retrieve events due to an internal error",
                    error: err.message
                });
            }

            // Check if there are any events for the provided client_id
            if (results.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: `No events found for client_id ${client_id}`
                });
            }

            // Send success response with events for the given client_id
            res.status(200).json({
                success: true,
                message: `Events retrieved successfully for client_id ${client_id}`,
                events: results
            });
        });

    } catch (error) {
        console.error('Error fetching events for client_id:', error);
        res.status(500).json({
            success: false,
            message: "Could not retrieve events due to an internal error",
            error: error.message
        });
    }
};

const checkEventExists = (req, res) => {
    console.log('Hit checkEventExist');
    const { event_code } = req.params;

    if (!event_code) {
        return res.status(400).json({ error: 'event_code is required' });
    }

    // Step 1: Check if the event exists and get client_id
    const eventQuery = 'SELECT client_id FROM events WHERE event_code = ?';
    db.query(eventQuery, [event_code], (err, eventResults) => {
        if (err) {
            console.error('Error checking event existence:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (eventResults.length === 0) {
            return res.status(404).json({ error: 'Event not found' });
        }

        const { client_id } = eventResults[0];

        // Step 2: Check client's plan expiry
        const clientQuery = 'SELECT Expiry_date FROM client WHERE CustomerId = ?';
        db.query(clientQuery, [client_id], (err, clientResults) => {
            if (err) {
                console.error('Error checking client plan:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (clientResults.length === 0) {
                return res.status(404).json({ error: 'Client not found' });
            }

            const { Expiry_date } = clientResults[0];
            const currentDate = new Date();

            // Step 3: Check if plan is expired
            if (Expiry_date && Expiry_date < currentDate) {
                return res.status(403).json({ error: 'You can\'t view this page now, contact your host.' });
            }

            // Step 4: Event exists and plan is not expired
            res.json({ message: 'Event exists', event_code });
        });
    });
};


module.exports = { addEvent, getAllEvents, deleteEvent, getEventsByClientId, checkEventExists }