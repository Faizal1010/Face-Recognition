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

        const emailFolderPath = path.join(__dirname, '../../super admin dashboard/assets/clientsProfiles', email);

        // Create the email folder if it doesn't exist
        fs.mkdirSync(emailFolderPath, { recursive: true });
        cb(null, emailFolderPath);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage }).single('profile');

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

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded',
            });
        }

        res.status(201).json({
            success: true,
            message: 'Image uploaded successfully',
            filePath: path.relative(path.join(__dirname, '../../Frontend'), req.file.path), // Return relative path for frontend usage
        });
    });
};

// Add Client handler (using MySQL)
const addClient = async (req, res) => {
    try {
        const { FirstName, LastName, Email, Password, PostalCode, State, City, Address, Notes, Profile, CustomerId } = req.body;

        console.log(CustomerId);

        // Validate the input
        if (!FirstName || !LastName || !Email || !Password || !PostalCode || !State || !City || !Address || !Notes || !Profile || !CustomerId) {
            return res.status(400).json({
                success: false,
                message: "All client details are required!"
            });
        }

        // Create the client record in MySQL
        const query = `
            INSERT INTO client (FirstName, LastName, Email, Password, PostalCode, State, City, Address, Notes, Profile, CustomerId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const values = [FirstName, LastName, Email, Password, PostalCode, State, City, Address, Notes, Profile, CustomerId];

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
        // First, fetch the client to get the email for folder deletion
        const query = 'SELECT Email FROM client WHERE CustomerId = ?';
        db.query(query, [clientId], (err, result) => {
            if (err) {
                console.error('Error fetching client for deletion:', err);
                return res.status(500).json({
                    success: false,
                    message: "Could not retrieve client for deletion",
                    error: err.message
                });
            }

            if (result.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Client not found"
                });
            }

            const email = result[0].Email;

            // Define the folder path where the profile picture is stored
            const emailFolderPath = path.join(__dirname, '../../super admin dashboard/assets/clientsProfiles', email);

            // Remove the folder and its contents
            try {
                fs.rmSync(emailFolderPath, { recursive: true, force: true });
                console.log(`Successfully deleted the folder for ${email}`);
            } catch (err) {
                console.error('Error deleting folder:', err);
                return res.status(500).json({
                    success: false,
                    message: "An error occurred while deleting the profile folder",
                    error: err.message
                });
            }

            // Now delete the client from the database
            const deleteQuery = 'DELETE FROM client WHERE CustomerId = ?';
            db.query(deleteQuery, [clientId], (err, result) => {
                if (err) {
                    console.error('Error deleting client:', err);
                    return res.status(500).json({
                        success: false,
                        message: "An error occurred while deleting the client",
                        error: err.message
                    });
                }

                if (result.affectedRows === 0) {
                    return res.status(404).json({
                        success: false,
                        message: "Client not found"
                    });
                }

                // Send success response if the client was deleted
                res.status(200).json({
                    success: true,
                    message: "Client and profile folder deleted successfully"
                });
            });
        });
    } catch (error) {
        console.error('Error deleting client:', error);
        res.status(500).json({
            success: false,
            message: "An error occurred while deleting the client",
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
        // Query to fetch the client by ID
        const query = 'SELECT * FROM client WHERE CustomerId = ?';

        db.query(query, [clientId], (err, results) => {
            if (err) {
                console.error('Error fetching client by ID:', err);
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
        console.error('Error fetching client by ID:', error);
        res.status(500).json({
            success: false,
            message: "Could not retrieve the client due to an internal error",
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

// const addDueAmount = async (req, res) => {
//     try {
//         const { CustomerId, additionalAmount } = req.body;

//         // Validate the input
//         if (!CustomerId || additionalAmount == null) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Customer ID and additional amount are required",
//             });
//         }

//         // Ensure additionalAmount is a valid number
//         const parsedAmount = Number(additionalAmount);
//         if (isNaN(parsedAmount)) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Additional amount must be a valid number",
//             });
//         }

//         // Find the client by CustomerId
//         const client = await Client.findOne({ CustomerId });

//         if (!client) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Client not found",
//             });
//         }

//         // Add the new amount to the existing DueAmount
//         client.DueAmount += parsedAmount;

//         // Save the updated client document
//         await client.save();

//         res.status(200).json({
//             success: true,
//             message: "Due amount updated successfully",
//             client,
//         });
//     } catch (error) {
//         console.error('Error updating due amount:', error);
//         res.status(500).json({
//             success: false,
//             message: "Could not update due amount due to an internal error",
//             error: error.message,
//         });
//     }
// };

// const subtractDueAmount = async (req, res) => {
//     try {
//         const { CustomerId, subtractAmount } = req.body;
//         console.log(CustomerId, subtractAmount)
//         // Validate the input
//         if (!CustomerId || subtractAmount == null) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Customer ID and subtract amount are required",
//             });
//         }

//         // Ensure subtractAmount is a valid number
//         const parsedAmount = Number(subtractAmount);
//         if (isNaN(parsedAmount) || parsedAmount < 0) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Subtract amount must be a valid non-negative number",
//             });
//         }

//         // Find the client by CustomerId
//         const client = await Client.findOne({ CustomerId });

//         if (!client) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Client not found",
//             });
//         }

//         // Ensure the DueAmount does not go negative
//         if (client.DueAmount < parsedAmount) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Subtract amount exceeds the due amount",
//             });
//         }

//         // Subtract the amount from DueAmount and add to PaidAmount
//         client.DueAmount -= parsedAmount;
//         client.PaidAmount += parsedAmount;

//         // Save the updated client document
//         await client.save();

//         res.status(200).json({
//             success: true,
//             message: "Due amount updated successfully",
//             client,
//         });
//     } catch (error) {
//         console.error('Error updating due amount:', error);
//         res.status(500).json({
//             success: false,
//             message: "Could not update due amount due to an internal error",
//             error: error.message,
//         });
//     }
// };

module.exports = { addClient, getClient, deleteClient, uploadProfile, getLatestClients, getClientById, getClientByCustomerId};