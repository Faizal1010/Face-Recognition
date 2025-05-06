const mysql = require('mysql2');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

// MySQL Database Connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'zxcvbnm1010@',
    database: 'face_recognition'
});

// Function to format category name
const formatCategoryName = (name) => {
    return name.trim().toLowerCase().replace(/\s+/g, '-');
};

// Define multer storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const email = req.body.email;
        console.log("the req.body at destination is ->", req.body);
        if (!email) {
            return cb(new Error('Email not provided'), null);
        }

        const emailFolderPath = path.join(__dirname, '../../public/assets/clientsProfiles', email);

        // Create the email folder if it doesn't exist
        fs.mkdirSync(emailFolderPath, { recursive: true });
        cb(null, emailFolderPath);
    },
    filename: (req, file, cb) => {
        if (file.fieldname === 'logo') {
            cb(null, 'logo.png');
        } else {
            cb(null, file.originalname);
        }
    }
});

// Accept both profile and logo
const upload = multer({ storage }).fields([
    { name: 'profile', maxCount: 1 },
    { name: 'logo', maxCount: 1 }
]);

// Upload Profile handler
const uploadProfile = async (req, res) => {
    upload(req, res, (err) => {
        if (err) {
            console.error('Error uploading profile image:', err);
            return res.status(500).json({
                success: false,
                message: "Image couldn't be uploaded due to an internal error",
                error: err.message,
            });
        }

        if (!req.files || !req.files.profile) {
            return res.status(400).json({
                success: false,
                message: 'No profile image uploaded',
            });
        }

        res.status(201).json({
            success: true,
            message: 'Image(s) uploaded successfully',
            filePath: path.relative(
                path.join(__dirname, '../../Frontend'),
                req.files.profile[0].path
            ), // Return relative path of profile image
        });
    });
};

// Add Client handler (using MySQL)
const addClient = async (req, res) => {
    try {
        const { FirstName, LastName, Email, ContactNo, Password, PostalCode, State, City, Address, Notes, Profile, CustomerId, Storage_limit, Storage_used, Expiry_date } = req.body;

        console.log(CustomerId);

        // Validate the input
        if (!FirstName || !LastName || !Email || !ContactNo || !Password || !PostalCode || !State || !City || !Address || !Notes || !Profile || !CustomerId || !Storage_limit || Storage_used === undefined) {
            return res.status(400).json({
                success: false,
                message: "All client details are required!"
            });
        }

        // Extract storage limit from Storage_limit (format: storage_limit+validity) and convert from GB to MB
        const storageLimitValue = parseInt(Storage_limit.split('+')[0]);
        const storageLimitInMB = storageLimitValue * 1024;

        // Create the client record in MySQL
        const query = `
            INSERT INTO client (FirstName, LastName, Email, ContactNo, Password, PostalCode, State, City, Address, Notes, Profile, CustomerId, Storage_limit, Storage_used, Expiry_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const values = [FirstName, LastName, Email, ContactNo, Password, PostalCode, State, City, Address, Notes, Profile, CustomerId, storageLimitInMB, Storage_used, Expiry_date || null];

        db.query(query, values, (err, result) => {
            if (err) {
                console.error('Error adding client:', err);
                return res.status(500).json({
                    success: false,
                    message: "Client couldn't be added due to an internal error",
                    error: err.message,
                });
            }

            // Return the newly added client (excluding Password for security)
            const newClient = {
                FirstName,
                LastName,
                Email,
                ContactNo,
                PostalCode,
                State,
                City,
                Address,
                Notes,
                Profile,
                CustomerId,
                Storage_limit: storageLimitInMB,
                Storage_used,
                Expiry_date
            };

            res.status(201).json({
                success: true,
                message: "Client added successfully",
                client: newClient
            });
        });

    } catch (error) {
        console.error('Error adding client:', error);
        res.status(500).json({
            success: false,
            message: "Client couldn't be added due to an internal error",
            error: error.message
        });
    }
};

const getClient = async (req, res) => {
    try {
        const query = 'SELECT * FROM client'; // Fetch all clients from the 'client' table

        db.query(query, (err, results) => {
            if (err) {
                console.error('Error fetching clients:', err);
                return res.status(500).json({
                    success: false,
                    message: "Could not retrieve clients due to an internal error",
                    error: err.message
                });
            }

            // Check if there are any clients
            if (results.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "No clients found"
                });
            }

            // Send success response with all clients
            res.status(200).json({
                success: true,
                message: "Clients retrieved successfully",
                clients: results
            });
        });
    } catch (error) {
        console.error('Error fetching clients:', error);
        res.status(500).json({
            success: false,
            message: "Could not retrieve clients due to an internal error",
            error: error.message
        });
    }
};

// Delete Client handler (using MySQL)
const deleteClient = async (req, res) => {
    const clientId = req.params.id;

    try {
        // Step 1: Fetch the client to get the email for folder deletion
        const clientQuery = 'SELECT Email FROM client WHERE CustomerId = ?';
        const clientResult = await new Promise((resolve, reject) => {
            db.query(clientQuery, [clientId], (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

        if (clientResult.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }

        const email = clientResult[0].Email;

        // Step 2: Delete related imageData (depends on images.id)
        const deleteImageDataQuery = `
            DELETE idata FROM imageData idata
            INNER JOIN images i ON idata.image_id = i.id
            WHERE i.client_id = ?
        `;
        await new Promise((resolve, reject) => {
            db.query(deleteImageDataQuery, [clientId], (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

        // Step 3: Delete related images (depends on client_id)
        const deleteImagesQuery = 'DELETE FROM images WHERE client_id = ?';
        await new Promise((resolve, reject) => {
            db.query(deleteImagesQuery, [clientId], (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

        // Step 4: Delete related carousel (depends on client_id)
        const deleteCarouselQuery = 'DELETE FROM carousel WHERE client_id = ?';
        await new Promise((resolve, reject) => {
            db.query(deleteCarouselQuery, [clientId], (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

        // Step 5: Delete related videos (depends on client_id) and their files
        const videoQuery = 'SELECT filename, event_code FROM videos WHERE client_id = ?';
        const videoResults = await new Promise((resolve, reject) => {
            db.query(videoQuery, [clientId], (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        });

        for (const video of videoResults) {
            const videoPath = path.join(__dirname, '../../public/videos', video.event_code, video.filename);
            try {
                await new Promise((resolve, reject) => {
                    fs.unlink(videoPath, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                console.log(`Successfully deleted video file: ${videoPath}`);
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    console.error(`Error deleting video file ${videoPath}:`, err);
                }
            }
        }

        // Delete video folders for each event_code
        const eventCodes = [...new Set(videoResults.map(video => video.event_code))];
        for (const eventCode of eventCodes) {
            const videoFolderPath = path.join(__dirname, '../videos', eventCode);
            try {
                await new Promise((resolve, reject) => {
                    fs.rm(videoFolderPath, { recursive: true, force: true }, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                console.log(`Successfully deleted video folder for event ${eventCode}: ${videoFolderPath}`);
            } catch (err) {
                console.error(`Error deleting video folder ${videoFolderPath}:`, err);
            }
        }

        const deleteVideosQuery = 'DELETE FROM videos WHERE client_id = ?';
        await new Promise((resolve, reject) => {
            db.query(deleteVideosQuery, [clientId], (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

        // Step 6: Delete related events (depends on client_id)
        const deleteEventsQuery = 'DELETE FROM events WHERE client_id = ?';
        await new Promise((resolve, reject) => {
            db.query(deleteEventsQuery, [clientId], (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

        // Step 7: Delete the client folder
        const emailFolderPath = path.join(__dirname, '../../public/assets/clientsProfiles', email);
        try {
            await new Promise((resolve, reject) => {
                fs.rm(emailFolderPath, { recursive: true, force: true }, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            console.log(`Successfully deleted the folder for ${email}`);
        } catch (err) {
            console.error('Error deleting folder:', err);
            // Not failing the request since folder deletion is secondary
        }

        // Step 8: Delete the client
        const deleteClientQuery = 'DELETE FROM client WHERE CustomerId = ?';
        const deleteResult = await new Promise((resolve, reject) => {
            db.query(deleteClientQuery, [clientId], (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

        if (deleteResult.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }

        // Send success response
        res.status(200).json({
            success: true,
            message: "Client and all associated data (events, images, imageData, videos, video folders, and profile folder) deleted successfully"
        });
    } catch (error) {
        console.error('Error deleting client and associated data:', error);
        res.status(500).json({
            success: false,
            message: "An error occurred while deleting the client and associated data",
            error: error.message
        });
    }
};

// Get Latest Clients handler (using MySQL)
const getLatestClients = async (req, res) => {
    try {
        const query = 'SELECT * FROM client ORDER BY CustomerId DESC LIMIT 5'; // Fetch the latest 5 clients

        db.query(query, (err, results) => {
            if (err) {
                console.error('Error fetching latest clients:', err);
                return res.status(500).json({
                    success: false,
                    message: "Could not retrieve latest clients due to an internal error",
                    error: err.message
                });
            }

            // Check if there are any clients
            if (results.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "No clients found"
                });
            }

            // Send success response with the newest clients
            res.status(200).json({
                success: true,
                message: "Newest clients retrieved successfully",
                clients: results
            });
        });
    } catch (error) {
        console.error('Error fetching newest clients:', error);
        res.status(500).json({
            success: false,
            message: "Could not retrieve clients due to an internal error",
            error: error.message
        });
    }
};

const getClientById = async (req, res) => {
    const clientId = req.params.id; // Retrieve client ID from the request parameters

    try {
        // Query 1: Fetch client details
        const clientQuery = 'SELECT * FROM client WHERE CustomerId = ?';
        const [clientResults] = await new Promise((resolve, reject) => {
            db.query(clientQuery, [clientId], (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        });

        if (!clientResults) {
            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }

        // Query 2: Fetch events for the client
        const eventsQuery = 'SELECT id, event_code, name FROM events WHERE client_id = ?';
        const eventsResults = await new Promise((resolve, reject) => {
            db.query(eventsQuery, [clientId], (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        });

        // Prepare events array with labels and counts for both images and videos
        const events = [];
        let totalVideoSize = 0;
        let totalVideoCount = 0;

        for (const event of eventsResults) {
            // Query 3: Fetch distinct labels and image counts for each event
            const imageLabelsQuery = `
                SELECT 
                    i.label AS name, 
                    COUNT(i.id) AS imageCount 
                FROM images i 
                WHERE i.client_id = ? AND i.event_code = ? 
                GROUP BY i.label
            `;
            const imageLabelsResults = await new Promise((resolve, reject) => {
                db.query(imageLabelsQuery, [clientId, event.event_code], (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            });

            // Query 4: Fetch video labels and counts for the event
            const videoLabelsQuery = `
                SELECT 
                    v.label AS name, 
                    COUNT(v.id) AS videoCount 
                FROM videos v 
                WHERE v.client_id = ? AND v.event_code = ? 
                GROUP BY v.label
            `;
            const videoLabelsResults = await new Promise((resolve, reject) => {
                db.query(videoLabelsQuery, [clientId, event.event_code], (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            });

            // Query 5: Fetch video filenames for size calculation
            const videoFilesQuery = `
                SELECT filename 
                FROM videos 
                WHERE client_id = ? AND event_code = ?
            `;
            const videoFilesResults = await new Promise((resolve, reject) => {
                db.query(videoFilesQuery, [clientId, event.event_code], (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            });

            console.log(`Video files for event ${event.event_code}:`, videoFilesResults);

            for (const video of videoFilesResults) {
                const videoPath = path.join(__dirname, '../videos', event.event_code, video.filename);
                try {
                    const stats = await new Promise((resolve, reject) => {
                        fs.stat(videoPath, (err, stats) => {
                            if (err) reject(err);
                            else resolve(stats);
                        });
                    });
                    totalVideoSize += stats.size;
                    totalVideoCount += 1;
                    console.log(`Found video: ${videoPath}, size: ${stats.size} bytes`);
                } catch (err) {
                    console.error(`Failed to read video file ${videoPath}:`, err.message);
                    if (err.code === 'ENOENT') {
                        console.error(`Video file does not exist: ${videoPath}`);
                    }
                }
            }

            events.push({
                name: event.name,
                event_code: event.event_code,
                imageLabels: imageLabelsResults.map(label => ({
                    name: label.name || 'Unlabeled', // Handle NULL labels
                    imageCount: parseInt(label.imageCount, 10)
                })),
                videoLabels: videoLabelsResults.map(label => ({
                    name: label.name || 'Unlabeled', // Handle NULL labels
                    videoCount: parseInt(label.videoCount, 10)
                }))
            });
        }

        // Query 6: Calculate total size of images (in bytes) for the client
        const imageSizeQuery = `
            SELECT SUM(LENGTH(image)) AS totalImageSize 
            FROM images 
            WHERE client_id = ?
        `;
        const imageSizeResult = await new Promise((resolve, reject) => {
            db.query(imageSizeQuery, [clientId], (err, results) => {
                if (err) reject(err);
                else resolve(results[0]);
            });
        });
        const totalImageSize = imageSizeResult.totalImageSize || 0; // Default to 0 if no images

        // Convert sizes to MB or GB for response
        const formatSize = (sizeInBytes) => {
            if (sizeInBytes >= 1024 * 1024 * 1024) { // GB
                return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
            } else if (sizeInBytes >= 1024 * 1024) { // MB
                return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
            } else { // Bytes
                return `${sizeInBytes} Bytes`;
            }
        };

        console.log(`Total video size: ${totalVideoSize} bytes, Total video count: ${totalVideoCount}`);

        // Send success response with all data
        res.status(200).json({
            success: true,
            message: "Client details retrieved successfully",
            client: {
                ...clientResults, // Spread client details
                events,           // Array of events with image and video labels
                totalImageSize: formatSize(totalImageSize), // Formatted total size of images
                totalVideoSize: formatSize(totalVideoSize), // Formatted total size of videos
                videoCount: totalVideoCount // Number of videos
            }
        });
    } catch (error) {
        console.error('Error fetching client details:', error);
        res.status(500).json({
            success: false,
            message: "Could not retrieve client details due to an internal error",
            error: error.message
        });
    }
};

// Get Client by CustomerId handler (using MySQL)
const getClientByCustomerId = async (req, res) => {
    const customerId = req.params.customerId; // Retrieve the CustomerId from the request parameters

    try {
        // Query to fetch the client by CustomerId
        const query = 'SELECT * FROM client WHERE CustomerId = ?';

        db.query(query, [customerId], (err, results) => {
            if (err) {
                console.error('Error fetching client by CustomerId:', err);
                return res.status(500).json({
                    success: false,
                    message: "Could not retrieve the client due to an internal error",
                    error: err.message
                });
            }

            // If no client is found, return a 404 error
            if (results.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Client not found"
                });
            }

            // Send success response with the client data
            res.status(200).json({
                success: true,
                message: "Client retrieved successfully",
                client: results[0] // We take the first result as it's based on CustomerId
            });
        });
    } catch (error) {
        console.error('Error fetching client by CustomerId:', error);
        res.status(500).json({
            success: false,
            message: "Could not retrieve the client due to an internal error",
            error: error.message
        });
    }
};

module.exports = { addClient, getClient, deleteClient, uploadProfile, getLatestClients, getClientById, getClientByCustomerId};