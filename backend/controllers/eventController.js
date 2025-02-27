const mysql = require('mysql2')

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
        const query = 'SELECT * FROM events'; // Fetch all events from the 'events' table

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

        // Create the delete query
        const query = 'DELETE FROM events WHERE id = ?';

        db.query(query, [id], (err, result) => {
            if (err) {
                console.error('Error deleting event:', err);
                return res.status(500).json({
                    success: false,
                    message: "Event couldn't be deleted due to an internal error",
                    error: err.message,
                });
            }

            // Check if the event was found and deleted
            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Event not found"
                });
            }

            // Send success response
            res.status(200).json({
                success: true,
                message: "Event deleted successfully"
            });
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


module.exports = { addEvent, getAllEvents, deleteEvent, getEventsByClientId }