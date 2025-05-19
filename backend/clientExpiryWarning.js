const mysql = require('mysql2');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
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
        rejectUnauthorized: false, // Relax for development
        minVersion: 'TLSv1.2' // Enforce modern TLS versions
    },
    logger: true, // Enable logging for debugging
    debug: true // Show detailed debug output
});

// Cron job to check client expiry dates daily at midnight (Kolkata time)
cron.schedule('0 0 * * *', async () => {
    console.log('Running client expiry warning check');

    try {
        // Query clients whose Expiry_date is exactly 11 days from now
        const selectQuery = `
            SELECT FirstName, Email, CustomerId, Expiry_date
            FROM client
            WHERE Expiry_date = DATE_ADD(CURDATE(), INTERVAL 11 DAY)
        `;
        db.query(selectQuery, async (err, results) => {
            if (err) {
                console.error('Error selecting clients with upcoming expiry:', err);
                return;
            }

            if (results.length === 0) {
                console.log('No clients with plans expiring in 11 days');
                return;
            }

            console.log(`Found ${results.length} clients with plans expiring in 11 days`);

            // Send warning email to each client
            for (const client of results) {
                const mailOptions = {
                    from: `"Your App" <${process.env.SMTP_USER}>`,
                    to: client.Email,
                    subject: 'Your Subscription Plan is About to Expire',
                    html: `
                        <h2>Dear ${client.FirstName},</h2>
                        <p>Your subscription plan (Customer ID: ${client.CustomerId}) is set to expire in 11 days on ${client.Expiry_date.toISOString().split('T')[0]}.</p>
                        <p>Please renew your plan to continue enjoying our services.</p>
                        <p>Visit <a href="${process.env.APP_URL}">${process.env.APP_URL}</a> to manage your subscription.</p>
                        <p>If you have any questions, contact our support team.</p>
                        <p>Best regards,<br>Your App Team</p>
                    `
                };

                try {
                    await transporter.sendMail(mailOptions);
                    console.log(`Sent expiry warning email to ${client.Email}`);
                } catch (emailErr) {
                    console.error(`Error sending expiry warning email to ${client.Email}:`, emailErr);
                }
            }
        });
    } catch (err) {
        console.error('Unexpected error in expiry warning cron job:', err);
    }
}, {
    timezone: 'Asia/Kolkata'
});

console.log('Client expiry warning cron job started');