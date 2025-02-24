const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Login route
router.post('/login', authController.login);

// Logout route
// router.post('/logout', authController.logout);

router.get('/check-session', authController.authenticate, (req, res) => {
    // Since the user is authenticated, return their data
    res.status(200).json({
        success: true,
        message: 'Session is valid',
        userId: req.user.id, // Extracted from the decoded token
        userEmail: req.user.email, // Extracted from the decoded token
    });
});


module.exports = router;
