const jwt = require('jsonwebtoken');
const mysql = require('mysql2');

// JWT Secret Key
const JWT_SECRET = 'sjbublbclqNRl893bp  83t395vb8nm3;cn'; // Replace with a strong, secure key

// Create MySQL connection pool
const pool = mysql.createPool({
    host: 'localhost',       // Replace with your MySQL host
    user: 'root',            // Replace with your MySQL username
    password: 'zxcvbnm1010@',            // Replace with your MySQL password
    database: 'face_recognition' // Replace with your database name
});

// Promisify the pool query for easy async/await handling
const promisePool = pool.promise();

// Login Controller
exports.login = async (req, res) => {
    console.log('Login attempt');
    try {
        const { Email, Password } = req.body;

        // Validate input
        if (!Email || !Password) {
            return res.status(400).json({ success: false, message: 'Email and Password are required' });
        }

        // Convert Email to lowercase for case-insensitive matching
        const emailLowerCase = Email.toLowerCase();

        // Query to check if the user exists in the 'client' table
        let [rows, fields] = await promisePool.execute('SELECT * FROM client WHERE email = ?', [emailLowerCase]);

        let user = rows[0];

        if (user) {
            // If found in 'Client', check password and generate token
            console.log('Found user in Client table');
            if (user.Password !== Password) {
                return res.status(401).json({ success: false, message: 'Invalid password' });
            }

            // Generate JWT with client information
            const token = jwt.sign(
                { id: user.CustomerId, email: user.Email, role: 'client' },
                JWT_SECRET,
                { expiresIn: '3d' }
            );

            // Send response with token for client
            return res.status(200).json({ success: true, message: 'Login successful', token });
        } else {
            // If not found in 'Client', check in 'admin' table
            [rows, fields] = await promisePool.execute('SELECT * FROM admin WHERE email = ?', [emailLowerCase]);

            user = rows[0];

            if (user) {
                // If found in 'Admin', check password and generate token
                console.log('Found user in Admin table');
                console.log('user.password', user.Password);
                console.log('Password', Password);
                if (user.password !== Password) {
                    return res.status(401).json({ success: false, message: 'Invalid password' });
                }

                // Generate JWT with admin information
                const token = jwt.sign(
                    { email: user.email, role: 'admin' },
                    JWT_SECRET,
                    { expiresIn: '3d' }
                );

                // Send response with token for admin
                return res.status(200).json({ success: true, message: 'Login successful', token });
            } else {
                // If user is not found in both tables
                console.log('User not found in either table');
                return res.status(404).json({ success: false, message: 'User not found' });
            }
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Middleware to Verify Token
exports.authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(403).json({ message: 'Token is required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // Add user info to the request
        console.log("req.user is ->", req.user);
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

// Example Protected Route
exports.protectedRoute = (req, res) => {
    res.status(200).json({ message: `Welcome, ${req.user.email}` });
};
