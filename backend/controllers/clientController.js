const mysql = require('mysql2');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

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
        const { FirstName, LastName, Email, ContactNo, Password, PostalCode, State, City, Address, Notes, Profile, CustomerId } = req.body;

        console.log(CustomerId);

        // Validate the input
        if (!FirstName || !LastName || !Email || !ContactNo || !Password || !PostalCode || !State || !City || !Address || !Notes || !Profile || !CustomerId) {
            return res.status(400).json({
                success: false,
                message: "All client details are required!"
            });
        }

        // Create the client record in MySQL
        const query = `
            INSERT INTO client (FirstName, LastName, Email, ContactNo, Password, PostalCode, State, City, Address, Notes, Profile, CustomerId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const values = [FirstName, LastName, Email, ContactNo, Password, PostalCode, State, City, Address, Notes, Profile, CustomerId];

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
                CustomerId
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

        // Step 4: Delete related events (depends on client_id)
        const deleteEventsQuery = 'DELETE FROM events WHERE client_id = ?';
        await new Promise((resolve, reject) => {
            db.query(deleteEventsQuery, [clientId], (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

        // Step 5: Delete the client folder
        const emailFolderPath = path.join(__dirname, '../../public/assets/clientsProfiles', email);
        try {
            fs.rmSync(emailFolderPath, { recursive: true, force: true });
            console.log(`Successfully deleted the folder for ${email}`);
        } catch (err) {
            console.error('Error deleting folder:', err);
            // Not failing the request since folder deletion is secondary
        }

        // Step 6: Delete the client
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
            message: "Client and all associated data (events, images, imageData, and profile folder) deleted successfully"
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

            // Query 4: Fetch distinct labels and video counts for each event
            const videoLabelsQuery = `
                SELECT 
                    v.label AS name, 
                    COUNT(DISTINCT v.video_id) AS videoCount 
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

        // Query 5: Calculate total size of images (in bytes) for the client
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

        // Query 6: Calculate total size of videos (in bytes) and total video count for the client
        const videoSizeQuery = `
            SELECT 
                SUM(LENGTH(chunk)) AS totalVideoSize,
                COUNT(DISTINCT video_id) AS videoCount
            FROM videos 
            WHERE client_id = ?
        `;
        const videoSizeResult = await new Promise((resolve, reject) => {
            db.query(videoSizeQuery, [clientId], (err, results) => {
                if (err) reject(err);
                else resolve(results[0]);
            });
        });
        const totalVideoSize = videoSizeResult.totalVideoSize || 0; // Default to 0 if no videos
        const videoCount = videoSizeResult.videoCount || 0; // Number of unique videos

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

        // Send success response with all data
        res.status(200).json({
            success: true,
            message: "Client details retrieved successfully",
            client: {
                ...clientResults, // Spread client details
                events,           // Array of events with image and video labels
                totalImageSize: formatSize(totalImageSize), // Formatted total size of images
                totalVideoSize: formatSize(totalVideoSize), // Formatted total size of videos
                videoCount        // Number of videos
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