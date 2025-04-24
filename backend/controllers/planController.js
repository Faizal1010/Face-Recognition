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

module.exports = { createPlan, getAllPlans, deletePlan, getPlanById };