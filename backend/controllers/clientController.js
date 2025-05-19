const mysql = require('mysql2');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

// MySQL Database Connection
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
});

// Nodemailer Transporter Configuration
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_PORT == 465, // Use SSL for port 465
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: {
        rejectUnauthorized: false, // Relax for development (set to true in production)
        minVersion: 'TLSv1.2' // Enforce modern TLS versions
    }
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

// Upload Profile handler (unchanged)
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
            ),
        });
    });
};

// Add Client handler (updated for verification)
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

        // Extract storage limit and convert from GB to MB
        const storageLimitValue = parseInt(Storage_limit.split('+')[0]);
        const storageLimitInMB = storageLimitValue * 1024;

        // Generate verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const createdAt = new Date();

        // Store in pending_clients
        const query = `
            INSERT INTO pending_clients (FirstName, LastName, Email, ContactNo, Password, PostalCode, State, City, Address, Notes, Profile, CustomerId, Storage_limit, Storage_used, Expiry_date, verification_token, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const values = [
            FirstName,
            LastName,
            Email,
            ContactNo,
            Password,
            PostalCode,
            State,
            City,
            Address,
            Notes,
            Profile,
            CustomerId,
            storageLimitInMB,
            Storage_used,
            Expiry_date || null,
            verificationToken,
            createdAt
        ];

        db.query(query, values, async (err, result) => {
            if (err) {
                console.error('Error adding pending client:', err);
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({
                        success: false,
                        message: "A client with this email or customer ID already exists"
                    });
                }
                return res.status(500).json({
                    success: false,
                    message: "Client couldn't be added due to a database error",
                    error: err.message
                });
            }

            // Send verification email
            const verificationLink = `${process.env.APP_URL}/clients/verify/${verificationToken}`;
            const mailOptions = {
                from: `"Your App" <${process.env.SMTP_USER}>`,
                to: Email,
                subject: 'Verify Your Email Address',
                html: `
                    <h2>Welcome to Your App!</h2>
                    <p>Please verify your email by clicking below:</p>
                    <a href="${verificationLink}" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Verify Email</a>
                    <p>This link expires in 24 hours.</p>
                `
            };

            try {
                await transporter.sendMail(mailOptions);
                res.status(201).json({
                    success: true,
                    message: "Verification email sent. Please check your inbox."
                });
            } catch (emailErr) {
                console.error('Error sending verification email:', emailErr);
                db.query('DELETE FROM pending_clients WHERE verification_token = ?', [verificationToken]);
                return res.status(500).json({
                    success: false,
                    message: "Failed to send verification email",
                    error: emailErr.message
                });
            }
        });

    } catch (error) {
        console.error('Error adding client:', error);
        res.status(500).json({
            success: false,
            message: "Client couldn't be added due to an unexpected error",
            error: error.message
        });
    }
};

// Verify Client handler
const verifyClient = async (req, res) => {
    const { token } = req.params;

    try {
        // Check token in pending_clients
        const query = 'SELECT * FROM pending_clients WHERE verification_token = ?';
        db.query(query, [token], async (err, results) => {
            if (err) {
                console.error('Error querying pending client:', err);
                return res.status(500).json({
                    success: false,
                    message: "Error verifying client",
                    error: err.message
                });
            }

            if (results.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid or expired verification token"
                });
            }

            const pendingClient = results[0];
            const createdAt = new Date(pendingClient.created_at);
            const now = new Date();
            const hoursDiff = (now - createdAt) / (1000 * 60 * 60);

            if (hoursDiff > 24) {
                db.query('DELETE FROM pending_clients WHERE verification_token = ?', [token]);
                return res.status(400).json({
                    success: false,
                    message: "Verification token has expired"
                });
            }

            // Move to client table
            const insertQuery = `
                INSERT INTO client (FirstName, LastName, Email, ContactNo, Password, PostalCode, State, City, Address, Notes, Profile, CustomerId, Storage_limit, Storage_used, Expiry_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

            const values = [
                pendingClient.FirstName,
                pendingClient.LastName,
                pendingClient.Email,
                pendingClient.ContactNo,
                pendingClient.Password,
                pendingClient.PostalCode,
                pendingClient.State,
                pendingClient.City,
                pendingClient.Address,
                pendingClient.Notes,
                pendingClient.Profile,
                pendingClient.CustomerId,
                pendingClient.Storage_limit,
                pendingClient.Storage_used,
                pendingClient.Expiry_date || null
            ];

            db.query(insertQuery, values, async (insertErr, insertResult) => {
                if (insertErr) {
                    console.error('Error adding client to client table:', insertErr);
                    return res.status(500).json({
                        success: false,
                        message: "Error completing verification",
                        error: insertErr.message
                    });
                }

                // Delete from pending_clients
                db.query('DELETE FROM pending_clients WHERE verification_token = ?', [token]);

                // Send confirmation email
                const mailOptions = {
                    from: `"Your App" <${process.env.SMTP_USER}>`,
                    to: pendingClient.Email,
                    subject: 'Account Created Successfully',
                    html: `
                        <h2>Welcome, ${pendingClient.FirstName}!</h2>
                        <p>Your account has been created.</p>
                        <p>Details:</p>
                        <ul>
                            <li>Email: ${pendingClient.Email}</li>
                            <li>Customer ID: ${pendingClient.CustomerId}</li>
                        </ul>
                        <p>Login at <a href="${process.env.APP_URL}">${process.env.APP_URL}</a>.</p>
                    `
                };

                try {
                    await transporter.sendMail(mailOptions);
                    res.status(200).json({
                        success: true,
                        message: "Email verified and client added successfully",
                        client: {
                            FirstName: pendingClient.FirstName,
                            LastName: pendingClient.LastName,
                            Email: pendingClient.Email,
                            ContactNo: pendingClient.ContactNo,
                            PostalCode: pendingClient.PostalCode,
                            State: pendingClient.State,
                            City: pendingClient.City,
                            Address: pendingClient.Address,
                            Notes: pendingClient.Notes,
                            Profile: pendingClient.Profile,
                            CustomerId: pendingClient.CustomerId,
                            Storage_limit: pendingClient.Storage_limit,
                            Storage_used: pendingClient.Storage_used,
                            Expiry_date: pendingClient.Expiry_date
                        }
                    });
                } catch (emailErr) {
                    console.error('Error sending confirmation email:', emailErr);
                    res.status(200).json({
                        success: true,
                        message: "Email verified and client added, but confirmation email failed",
                        client: {
                            FirstName: pendingClient.FirstName,
                            LastName: pendingClient.LastName,
                            Email: pendingClient.Email,
                            ContactNo: pendingClient.ContactNo,
                            PostalCode: pendingClient.PostalCode,
                            State: pendingClient.State,
                            City: pendingClient.City,
                            Address: pendingClient.Address,
                            Notes: pendingClient.Notes,
                            Profile: pendingClient.Profile,
                            CustomerId: pendingClient.CustomerId,
                            Storage_limit: pendingClient.Storage_limit,
                            Storage_used: pendingClient.Storage_used,
                            Expiry_date: pendingClient.Expiry_date
                        }
                    });
                }
            });
        });
    } catch (error) {
        console.error('Error verifying client:', error);
        res.status(500).json({
            success: false,
            message: "Error verifying client",
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

const getAdminDashboardData = async (req, res) => {
    try {
        // Query 1: Count total clients
        const clientCountQuery = 'SELECT COUNT(*) AS clientCount FROM client';
        const clientCountResult = await new Promise((resolve, reject) => {
            db.query(clientCountQuery, (err, results) => {
                if (err) reject(err);
                else resolve(results[0]);
            });
        });

        // Query 2: Count total events
        const eventCountQuery = 'SELECT COUNT(*) AS eventCount FROM events';
        const eventCountResult = await new Promise((resolve, reject) => {
            db.query(eventCountQuery, (err, results) => {
                if (err) reject(err);
                else resolve(results[0]);
            });
        });

        // Query 3: Count total images and calculate total image size
        const imageStatsQuery = `
            SELECT 
                COUNT(*) AS imageCount,
                SUM(LENGTH(image)) AS totalImageSize
            FROM images
        `;
        const imageStatsResult = await new Promise((resolve, reject) => {
            db.query(imageStatsQuery, (err, results) => {
                if (err) reject(err);
                else resolve(results[0]);
            });
        });

        // Query 4: Fetch all video filenames for size calculation
        const videoFilesQuery = `
            SELECT filename, event_code
            FROM videos
        `;
        const videoFilesResults = await new Promise((resolve, reject) => {
            db.query(videoFilesQuery, (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        });

        // Calculate total video size using callback-based fs.stat
        let totalVideoSize = 0;
        let totalVideoCount = videoFilesResults.length;

        for (const video of videoFilesResults) {
            const videoPath = path.join(__dirname, '../videos', video.event_code, video.filename);
            try {
                const stats = await new Promise((resolve, reject) => {
                    fs.stat(videoPath, (err, stats) => {
                        if (err) reject(err);
                        else resolve(stats);
                    });
                });
                totalVideoSize += stats.size;
                console.log(`Found video: ${videoPath}, size: ${stats.size} bytes`);
            } catch (err) {
                console.error(`Failed to read video file ${videoPath}:`, err.message);
                if (err.code === 'ENOENT') {
                    console.error(`Video file does not exist: ${videoPath}`);
                }
            }
        }

        // Format sizes to MB or GB
        const formatSize = (sizeInBytes) => {
            if (sizeInBytes >= 1024 * 1024 * 1024) { // GB
                return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
            } else if (sizeInBytes >= 1024 * 1024) { // MB
                return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
            } else { // Bytes
                return `${sizeInBytes} Bytes`;
            }
        };

        // Send success response with aggregated data
        res.status(200).json({
            success: true,
            message: "Admin dashboard data retrieved successfully",
            data: {
                totalClients: clientCountResult.clientCount,
                totalEvents: eventCountResult.eventCount,
                totalImages: imageStatsResult.imageCount,
                totalImageSize: formatSize(imageStatsResult.totalImageSize || 0),
                totalVideos: totalVideoCount,
                totalVideoSize: formatSize(totalVideoSize)
            }
        });
    } catch (error) {
        console.error('Error fetching admin dashboard data:', error);
        res.status(500).json({
            success: false,
            message: "Could not retrieve dashboard data due to an internal error",
            error: error.message
        });
    }
};

module.exports = { addClient, getClient, deleteClient, uploadProfile, getLatestClients, getClientById, getClientByCustomerId, getAdminDashboardData, verifyClient};