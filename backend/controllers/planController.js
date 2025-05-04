const mysql = require('mysql2');

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'zxcvbnm1010@',
    database: 'face_recognition'
});

// Create Plan handler (using MySQL)
const createPlan = async (req, res) => {
    try {
        const { plan_name, storage_limit, validity, plan_description } = req.body;

        // Validate the input
        if (!plan_name || !storage_limit || !validity) {
            return res.status(400).json({
                success: false,
                message: "Plan Name, Storage Limit, and Validity are required!"
            });
        }

        // Create the plan record in MySQL
        const query = `
            INSERT INTO plans (plan_name, storage_limit, validity, plan_description)
            VALUES (?, ?, ?, ?)`;

        const values = [plan_name, storage_limit, validity, plan_description || null];

        db.query(query, values, (err, result) => {
            if (err) {
                console.error('Error creating plan:', err);
                return res.status(500).json({
                    success: false,
                    message: "Plan couldn't be created due to an internal error",
                    error: err.message,
                });
            }

            // Return the newly created plan
            const newPlan = {
                id: result.insertId,
                plan_name,
                storage_limit,
                validity,
                plan_description
            };

            res.status(201).json({
                success: true,
                message: "Plan created successfully",
                plan: newPlan
            });
        });

    } catch (error) {
        console.error('Error creating plan:', error);
        res.status(500).json({
            success: false,
            message: "Plan couldn't be created due to an internal error",
            error: error.message
        });
    }
};

// Get All Plans handler (using MySQL)
const getAllPlans = async (req, res) => {
    try {
        const query = 'SELECT * FROM plans';

        db.query(query, (err, results) => {
            if (err) {
                console.error('Error fetching plans:', err);
                return res.status(500).json({
                    success: false,
                    message: "Could not retrieve plans due to an internal error",
                    error: err.message
                });
            }

            // Check if there are any plans
            if (results.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "No plans found"
                });
            }

            // Send success response with all plans
            res.status(200).json({
                success: true,
                message: "Plans retrieved successfully",
                plans: results
            });
        });
    } catch (error) {
        console.error('Error fetching plans:', error);
        res.status(500).json({
            success: false,
            message: "Could not retrieve plans due to an internal error",
            error: error.message
        });
    }
};

// Delete Plan handler (using MySQL)
const deletePlan = async (req, res) => {
    try {
        const { id } = req.params; // Extract the plan ID from the URL params

        // Validate the input
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Plan ID is required!"
            });
        }

        // Create the delete query
        const query = 'DELETE FROM plans WHERE id = ?';

        db.query(query, [id], (err, result) => {
            if (err) {
                console.error('Error deleting plan:', err);
                return res.status(500).json({
                    success: false,
                    message: "Plan couldn't be deleted due to an internal error",
                    error: err.message,
                });
            }

            // Check if the plan was found and deleted
            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Plan not found"
                });
            }

            // Send success response
            res.status(200).json({
                success: true,
                message: "Plan deleted successfully"
            });
        });

    } catch (error) {
        console.error('Error deleting plan:', error);
        res.status(500).json({
            success: false,
            message: "Plan couldn't be deleted due to an internal error",
            error: error.message
        });
    }
};

// Get Plan by ID handler (using MySQL)
const getPlanById = async (req, res) => {
    try {
        const { id } = req.params; // Extract the plan ID from the URL params

        // Validate the input
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Plan ID is required!"
            });
        }

        // Create the query to fetch plan based on id
        const query = 'SELECT * FROM plans WHERE id = ?';

        db.query(query, [id], (err, results) => {
            if (err) {
                console.error('Error fetching plan:', err);
                return res.status(500).json({
                    success: false,
                    message: "Could not retrieve plan due to an internal error",
                    error: err.message
                });
            }

            // Check if the plan exists
            if (results.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: `No plan found with id ${id}`
                });
            }

            // Send success response with the plan
            res.status(200).json({
                success: true,
                message: `Plan retrieved successfully for id ${id}`,
                plan: results[0]
            });
        });

    } catch (error) {
        console.error('Error fetching plan:', error);
        res.status(500).json({
            success: false,
            message: "Could not retrieve plan due to an internal error",
            error: error.message
        });
    }
};

const upgradePlan = async (req, res) => {
    try {
        const { customerId } = req.params;
        const { storage_limit, validity } = req.body;

        // Validate the input
        if (!customerId || !storage_limit || !validity) {
            return res.status(400).json({
                success: false,
                message: "Customer ID, Storage Limit, and Validity are required!"
            });
        }

        // Convert storage_limit from GB to MB
        const newStorageLimitMB = parseInt(storage_limit) * 1024;
        const validityDays = parseInt(validity);

        // Validate numeric inputs
        if (isNaN(newStorageLimitMB) || isNaN(validityDays) || validityDays <= 0) {
            return res.status(400).json({
                success: false,
                message: "Storage Limit and Validity must be valid positive numbers!"
            });
        }

        // Fetch the client's current details
        const selectQuery = 'SELECT Storage_limit, Storage_used, Expiry_date FROM client WHERE CustomerId = ?';
        db.query(selectQuery, [customerId], (err, results) => {
            if (err) {
                console.error('Error fetching client details:', err);
                return res.status(500).json({
                    success: false,
                    message: "Could not retrieve client details due to an internal error",
                    error: err.message
                });
            }

            if (results.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: `No client found with Customer ID ${customerId}`
                });
            }

            const client = results[0];
            const currentStorageLimitMB = client.Storage_limit;
            const storageUsedMB = client.Storage_used;

            // Calculate new Expiry_date (today + validity days)
            const currentDate = new Date();
            currentDate.setDate(currentDate.getDate() + validityDays);
            const newExpiryDate = currentDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD

            // Check if it's an upgrade (new storage_limit > current storage_limit)
            if (newStorageLimitMB > currentStorageLimitMB) {
                // Upgrade: Update Storage_limit and Expiry_date
                const updateQuery = `
                    UPDATE client
                    SET Storage_limit = ?, Expiry_date = ?
                    WHERE CustomerId = ?`;
                const updateValues = [newStorageLimitMB, newExpiryDate, customerId];

                db.query(updateQuery, updateValues, (updateErr, updateResult) => {
                    if (updateErr) {
                        console.error('Error updating client plan:', updateErr);
                        return res.status(500).json({
                            success: false,
                            message: "Could not update client plan due to an internal error",
                            error: updateErr.message
                        });
                    }

                    if (updateResult.affectedRows === 0) {
                        return res.status(404).json({
                            success: false,
                            message: `No client found with Customer ID ${customerId}`
                        });
                    }

                    res.status(200).json({
                        success: true,
                        message: "Client plan upgraded successfully",
                        updatedDetails: {
                            customerId,
                            storage_limit: newStorageLimitMB,
                            expiry_date: newExpiryDate
                        }
                    });
                });
            } else if (newStorageLimitMB < currentStorageLimitMB) {
                // Downgrade: Check if Storage_used exceeds new Storage_limit
                if (storageUsedMB > newStorageLimitMB) {
                    return res.status(400).json({
                        success: false,
                        message: `Downgrade not possible: Storage used (${storageUsedMB} MB) exceeds new storage limit (${newStorageLimitMB} MB)`
                    });
                }

                // Downgrade: Update Storage_limit and Expiry_date
                const updateQuery = `
                    UPDATE client
                    SET Storage_limit = ?, Expiry_date = ?
                    WHERE CustomerId = ?`;
                const updateValues = [newStorageLimitMB, newExpiryDate, customerId];

                db.query(updateQuery, updateValues, (updateErr, updateResult) => {
                    if (updateErr) {
                        console.error('Error updating client plan:', updateErr);
                        return res.status(500).json({
                            success: false,
                            message: "Could not update client plan due to an internal error",
                            error: updateErr.message
                        });
                    }

                    if (updateResult.affectedRows === 0) {
                        return res.status(404).json({
                            success: false,
                            message: `No client found with Customer ID ${customerId}`
                        });
                    }

                    res.status(200).json({
                        success: true,
                        message: "Client plan downgraded successfully",
                        updatedDetails: {
                            customerId,
                            storage_limit: newStorageLimitMB,
                            expiry_date: newExpiryDate
                        }
                    });
                });
            } else {
                // Same storage limit: Only update Expiry_date
                const updateQuery = `
                    UPDATE client
                    SET Expiry_date = ?
                    WHERE CustomerId = ?`;
                const updateValues = [newExpiryDate, customerId];

                db.query(updateQuery, updateValues, (updateErr, updateResult) => {
                    if (updateErr) {
                        console.error('Error updating client plan:', updateErr);
                        return res.status(500).json({
                            success: false,
                            message: "Could not update client plan due to an internal error",
                            error: updateErr.message
                        });
                    }

                    if (updateResult.affectedRows === 0) {
                        return res.status(404).json({
                            success: false,
                            message: `No client found with Customer ID ${customerId}`
                        });
                    }

                    res.status(200).json({
                        success: true,
                        message: "Client plan expiry date updated successfully",
                        updatedDetails: {
                            customerId,
                            storage_limit: newStorageLimitMB,
                            expiry_date: newExpiryDate
                        }
                    });
                });
            }
        });
    } catch (error) {
        console.error('Error processing plan upgrade:', error);
        res.status(500).json({
            success: false,
            message: "Could not process plan upgrade due to an internal error",
            error: error.message
        });
    }
};


module.exports = { createPlan, getAllPlans, deletePlan, getPlanById, upgradePlan };