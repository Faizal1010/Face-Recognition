const mysql = require('mysql2');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// DB Connection
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
});

exports.uploadCarouselImage = async (req, res) => {
    // Detailed debugging logs
    console.log('Request Body:', req.body);
    console.log('Request File:', req.file ? {
        fieldname: req.file.fieldname,
        originalName: req.file.originalName,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path
    } : 'No file received');

    const { event_code, client_id } = req.body;
    const image = req.file;

    if (!image || !event_code || !client_id) {
        console.error('Missing required fields:', {
            hasImage: !!image,
            hasEventCode: !!event_code,
            hasClientId: !!client_id
        });
        if (image) {
            await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
        }
        return res.status(400).json({ success: false, message: 'Image, event_code, and client_id are required' });
    }

    // Validate file mimetype
    if (!image.mimetype.startsWith('image/')) {
        await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
        return res.status(400).json({ success: false, message: 'Only image files are allowed' });
    }

    // Check if the event exists
    db.query('SELECT id FROM events WHERE event_code = ? AND client_id = ?', [event_code, client_id], async (err, eventResults) => {
        if (err) {
            console.error('Error checking event:', err);
            await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
            return res.status(500).json({ success: false, message: 'Error checking event' });
        }
        if (eventResults.length === 0) {
            await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
            return res.status(400).json({ success: false, message: 'Invalid event or client' });
        }

        // Check current number of carousel images and determine position
        db.query('SELECT COUNT(*) AS count FROM carousel WHERE event_code = ?', [event_code], async (err, countResults) => {
            if (err) {
                console.error('Error counting carousel images:', err);
                await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                return res.status(500).json({ success: false, message: 'Error counting carousel images' });
            }
            const imageCount = countResults[0].count;
            if (imageCount >= 3) {
                await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                return res.status(400).json({ success: false, message: 'Maximum of 3 carousel images already uploaded for this event' });
            }
            const position = imageCount + 1; // Assign position (1, 2, or 3)
            console.log('Assigned Position:', position);

            // Check storage limit
            db.query('SELECT Storage_limit, Storage_used FROM client WHERE CustomerId = ?', [client_id], async (err, clientResults) => {
                if (err) {
                    console.error('Error fetching client storage:', err);
                    await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                    return res.status(500).json({ success: false, message: 'Error fetching client storage' });
                }
                if (clientResults.length === 0) {
                    await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                    return res.status(400).json({ success: false, message: 'Client not found' });
                }

                const { Storage_limit, Storage_used } = clientResults[0];
                const imageSizeMB = image.size / (1024 * 1024); // Convert bytes to MB
                if (Storage_used + imageSizeMB > Storage_limit) {
                    await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                    return res.status(400).json({ success: false, message: 'Storage limit exceeded' });
                }

                try {
                    // Compress image with sharp
                    const compressedBuffer = await sharp(image.path)
                        .jpeg({ quality: 80 })
                        .toBuffer();

                    // Insert image into carousel table with position
                    db.query(
                        'INSERT INTO carousel (client_id, event_code, image, position) VALUES (?, ?, ?, ?)',
                        [client_id, event_code, compressedBuffer, position],
                        async (err, result) => {
                            if (err) {
                                console.error('Error uploading carousel image:', err);
                                await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                                return res.status(500).json({ success: false, message: 'Error uploading carousel image' });
                            }

                            // Delete temporary file
                            await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                            res.json({ success: true, message: 'Carousel image uploaded successfully' });
                        }
                    );
                } catch (err) {
                    console.error('Error compressing image:', err);
                    await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                    res.status(500).json({ success: false, message: 'Error compressing image' });
                }
            });
        });
    });
};

exports.getCarouselImages = (req, res) => {
    const { eventId } = req.params;

    db.query('SELECT id, image, position FROM carousel WHERE event_code = ? ORDER BY position ASC', [eventId], (err, results) => {
        if (err) {
            console.error('Error fetching carousel images:', err);
            return res.status(500).json({ success: false, message: 'Error fetching carousel images' });
        }

        // Compress images before sending
        Promise.all(results.map(r =>
            sharp(r.image)
                .jpeg({ quality: 50 })
                .toBuffer()
                .then(compressedBuffer => ({
                    id: r.id,
                    position: r.position,
                    data: compressedBuffer.toString('base64')
                }))
        ))
        .then(images => {
            res.json({ success: true, images });
        })
        .catch(err => {
            console.error('Error compressing images:', err);
            res.status(500).json({ success: false, message: 'Error compressing images' });
        });
    });
};

exports.updateCarouselImage = async (req, res) => {
    console.log('Update Request Body:', req.body);
    console.log('Update Request File:', req.file ? {
        fieldname: req.file.fieldname,
        originalName: req.file.originalName,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path
    } : 'No file received');

    const { event_code, client_id, image_id } = req.body;
    const image = req.file;

    if (!image || !event_code || !client_id || !image_id) {
        console.error('Missing required fields for update:', {
            hasImage: !!image,
            hasEventCode: !!event_code,
            hasClientId: !!client_id,
            hasImageId: !!image_id
        });
        if (image) {
            await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
        }
        return res.status(400).json({ success: false, message: 'Image, event_code, client_id, and image_id are required' });
    }

    // Validate file mimetype
    if (!image.mimetype.startsWith('image/')) {
        await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
        return res.status(400).json({ success: false, message: 'Only image files are allowed' });
    }

    // Check if the event and image exist
    db.query('SELECT id FROM events WHERE event_code = ? AND client_id = ?', [event_code, client_id], async (err, eventResults) => {
        if (err) {
            console.error('Error checking event:', err);
            await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
            return res.status(500).json({ success: false, message: 'Error checking event' });
        }
        if (eventResults.length === 0) {
            await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
            return res.status(400).json({ success: false, message: 'Invalid event or client' });
        }

        // Check if the carousel image exists
        db.query('SELECT image FROM carousel WHERE id = ? AND event_code = ? AND client_id = ?', [image_id, event_code, client_id], async (err, imageResults) => {
            if (err) {
                console.error('Error checking carousel image:', err);
                await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                return res.status(500).json({ success: false, message: 'Error checking carousel image' });
            }
            if (imageResults.length === 0) {
                await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                return res.status(400).json({ success: false, message: 'Carousel image not found' });
            }

            // Check storage limit
            db.query('SELECT Storage_limit, Storage_used FROM client WHERE CustomerId = ?', [client_id], async (err, clientResults) => {
                if (err) {
                    console.error('Error fetching client storage:', err);
                    await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                    return res.status(500).json({ success: false, message: 'Error fetching client storage' });
                }
                if (clientResults.length === 0) {
                    await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                    return res.status(400).json({ success: false, message: 'Client not found' });
                }

                const { Storage_limit, Storage_used } = clientResults[0];
                const oldImageSizeMB = Buffer.byteLength(imageResults[0].image) / (1024 * 1024); // Size of old image
                const newImageSizeMB = image.size / (1024 * 1024); // Size of new image
                const sizeDifference = newImageSizeMB - oldImageSizeMB; // Net change in storage

                if (Storage_used + sizeDifference > Storage_limit) {
                    await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                    return res.status(400).json({ success: false, message: 'Storage limit exceeded' });
                }

                try {
                    // Compress new image with sharp
                    const compressedBuffer = await sharp(image.path)
                        .jpeg({ quality: 80 })
                        .toBuffer();

                    // Update the carousel image
                    db.query(
                        'UPDATE carousel SET image = ? WHERE id = ? AND event_code = ? AND client_id = ?',
                        [compressedBuffer, image_id, event_code, client_id],
                        async (err, result) => {
                            if (err) {
                                console.error('Error updating carousel image:', err);
                                await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                                return res.status(500).json({ success: false, message: 'Error updating carousel image' });
                            }
                            if (result.affectedRows === 0) {
                                await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                                return res.status(400).json({ success: false, message: 'No image updated' });
                            }

                            // Delete temporary file
                            await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                            res.json({ success: true, message: 'Carousel image updated successfully' });
                        }
                    );
                } catch (err) {
                    console.error('Error compressing image:', err);
                    await fs.unlink(image.path).catch(err => console.error('Error deleting temp file:', err));
                    res.status(500).json({ success: false, message: 'Error compressing image' });
                }
            });
        });
    });
};