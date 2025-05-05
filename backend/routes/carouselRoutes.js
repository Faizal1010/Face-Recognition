const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const carouselController = require('../controllers/carouselController');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // Fallback to .jpg if originalName is undefined
        const extension = file && file.originalName ? path.extname(file.originalName) : '.jpg';
        cb(null, file.fieldname + '-' + uniqueSuffix + extension);
    }
});

// File filter to validate uploads
const fileFilter = (req, file, cb) => {
    if (!file) {
        return cb(new Error('No file uploaded'), false);
    }
    // Accept only images
    if (!file.mimetype.startsWith('image/')) {
        return cb(new Error('Only image files are allowed'), false);
    }
    cb(null, true);
};

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter
});

router.post('/upload', upload.single('image'), (req, res, next) => {
    // Handle multer errors
    if (!req.file && !req.body.event_code && !req.body.client_id) {
        return res.status(400).json({ success: false, message: 'Image, event_code, and client_id are required' });
    }
    next();
}, carouselController.uploadCarouselImage);

router.get('/images/:eventId', carouselController.getCarouselImages);

router.post('/update', upload.single('image'), (req, res, next) => {
    // Handle multer errors
    if (!req.file && !req.body.event_code && !req.body.client_id && !req.body.image_id) {
        return res.status(400).json({ success: false, message: 'Image, event_code, client_id, and image_id are required' });
    }
    next();
}, carouselController.updateCarouselImage);

module.exports = router;