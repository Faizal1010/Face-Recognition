const mysql = require('mysql2');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config()

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
});

cron.schedule('0 * * * *', () => {
    console.log('Running cleanup for expired pending clients');
    const selectQuery = `
        SELECT Email FROM pending_clients
        WHERE created_at < NOW() - INTERVAL 24 HOUR
    `;
    db.query(selectQuery, (err, results) => {
        if (err) {
            console.error('Error selecting expired pending clients:', err);
            return;
        }

        const deleteQuery = `
            DELETE FROM pending_clients
            WHERE created_at < NOW() - INTERVAL 24 HOUR
        `;
        db.query(deleteQuery, (deleteErr, deleteResult) => {
            if (deleteErr) {
                console.error('Error cleaning up pending clients:', deleteErr);
            } else {
                console.log(`Deleted ${deleteResult.affectedRows} expired pending clients`);
            }
        });

        results.forEach(({ Email }) => {
            const emailFolderPath = path.join(__dirname, '../public/assets/clientsProfiles', Email);
            fs.rm(emailFolderPath, { recursive: true, force: true }, (fsErr) => {
                if (fsErr) {
                    console.error(`Error deleting folder for ${Email}:`, fsErr);
                } else {
                    console.log(`Deleted folder for ${Email}`);
                }
            });
        });
    });
});

console.log('Cleanup cron job started');