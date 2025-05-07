const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const uploadDir = path.join(__dirname, 'Uploads');

const upload = multer({ 
    dest: uploadDir, 
    limits: { files: 500, fieldSize: 1024 * 1024 * 100 } // Increased limits
});

app.use(cors({
    origin: '*', // Specify the exact frontend origin
    credentials: true, // Allow credentials (cookies, authorization headers)
}));
app.use(express.static(path.join(__dirname, '../website')));
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json({ limit: "500gb" }));
app.use(express.urlencoded({ extended: true, limit: "500gb" }));

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'zxcvbnm1010@',
    database: 'face_recognition'
});

// Helper function to run Python script safely
function runPythonScript(scriptPath, args, callback) {
    const pythonProcess = spawn('python', [scriptPath, ...args]);
  
    let output = '';
    let errorOutput = '';
  
    pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
    });
  
    pythonProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.log('Python stderr:', data.toString()); // Log stderr for debugging
    });
  
    pythonProcess.on('close', (code) => {
        console.log(`Python script exited with code ${code}`);
        if (code !== 0) {
            // If there's an error, include the output (which contains the error message) in the callback
            const errorMessage = output || errorOutput || `Python script failed with code ${code}`;
            return callback(new Error(errorMessage), output);
        }
        callback(null, output);
    });
}

// Upload endpoint (processes files in batches)
app.post('/upload', upload.array('image', 500), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).send('No files uploaded');
    }

    const { client_id, event_code, label } = req.body;
    if (!client_id || !event_code || !label) {
        return res.status(400).send('Client ID, event code, and label are required');
    }

    console.log(`📦 Total files received: ${req.files.length}`);

    // Ensure directory exists
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    const jsonFilePath = path.join(uploadDir, `files_${Date.now()}.json`);
    const jsonData = {
        filePaths: req.files.map(file => file.path),
        client_id,
        event_code,
        label
    };

    try {
        fs.writeFileSync(jsonFilePath, JSON.stringify(jsonData));
        console.log(`📁 JSON file created: ${jsonFilePath}`);
    } catch (err) {
        console.error(`❌ Failed to write JSON file: ${err}`);
        return res.status(500).send('Internal Server Error');
    }

    // Run Python script safely with absolute path
    const scriptPath = path.join(__dirname, 'scripts', 'extract_embeddings.py'); // Use path.join for consistency
    process.nextTick(() => {
        runPythonScript(scriptPath, [jsonFilePath], (err, output) => {
            if (err) {
                console.error(`❌ Python script error: ${err.message}`);
                req.files.forEach(file => fs.unlinkSync(file.path));
                fs.unlinkSync(jsonFilePath);
                // Send the error message (from Python script output) to the frontend
                let errorData;
                try {
                    errorData = JSON.parse(output);
                } catch (parseErr) {
                    errorData = { status: "error", message: "Failed to process images" };
                }
                return res.status(500).json({ message: 'Error processing images', data: JSON.stringify(errorData) });
            }

            console.log(`✅ All files processed successfully.`);

            // Cleanup
            req.files.forEach(file => {
                fs.unlink(file.path, (unlinkErr) => {
                    if (unlinkErr) console.error(`⚠️ Error deleting file: ${file.path}`);
                });
            });

            fs.unlink(jsonFilePath, (unlinkErr) => {
                if (unlinkErr) console.error(`⚠️ Error deleting JSON file: ${jsonFilePath}`);
            });

            res.send({ message: 'Processing completed successfully', data: output });
        });
    });
});

// Recognize endpoint
app.post('/recognize', upload.single('image'), (req, res) => {
    console.log('Processing /recognize request');
    const jsonFilePath = path.join(__dirname, 'Uploads', ` BUDGETrecognize_${Date.now()}.json`);
    const jsonData = {
        imagePath: req.file.path,
        labels: req.body.labels || '[]',
        event_code: req.body.event_code || ''
    };

    fs.writeFileSync(jsonFilePath, JSON.stringify(jsonData));
    console.log(`JSON file created: ${jsonFilePath}`);

    const scriptPath = 'E:\\Web Development\\PROJECT\\FaceRecog2\\backend\\scripts\\compare_faces.py';

    runPythonScript(scriptPath, [jsonFilePath], (err, output) => {
        if (err) {
            console.error('Python script error:', err.message);
            // Cleanup before sending response
            fs.unlink(req.file.path, (unlinkErr) => {
                if (unlinkErr) console.error(`⚠️ Error deleting image file: ${req.file.path}`);
            });
            fs.unlink(jsonFilePath, (unlinkErr) => {
                if (unlinkErr) console.error(`⚠️ Error deleting JSON file: ${jsonFilePath}`);
            });
            return res.status(500).send(`Error recognizing image: ${err.message}`);
        }
        // Read result from the same JSON file
        try {
            const parsedData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));
            console.log('Python output:', parsedData);
            if (parsedData.error) {
                // Cleanup before sending response
                fs.unlink(req.file.path, (unlinkErr) => {
                    if (unlinkErr) console.error(`⚠️ Error deleting image file: ${req.file.path}`);
                });
                fs.unlink(jsonFilePath, (unlinkErr) => {
                    if (unlinkErr) console.error(`⚠️ Error deleting JSON file: ${jsonFilePath}`);
                });
                return res.status(500).send(parsedData.error);
            }

            if (parsedData.status === 'match_found') {
                const imageDataIds = parsedData.matched_images; // These are imageData.id values
                console.log('Matched imageData IDs:', imageDataIds);

                // First, map imageData.id to imageData.image_id
                db.query('SELECT image_id FROM imageData WHERE id IN (?)', [imageDataIds], (err, imageIdResults) => {
                    if (err) {
                        console.error('Database error (fetching image_id):', err);
                        // Cleanup before sending response
                        fs.unlink(req.file.path, (unlinkErr) => {
                            if (unlinkErr) console.error(`⚠️ Error deleting image file: ${req.file.path}`);
                        });
                        fs.unlink(jsonFilePath, (unlinkErr) => {
                            if (unlinkErr) console.error(`⚠️ Error deleting JSON file: ${jsonFilePath}`);
                        });
                        return res.status(500).send('Error retrieving image IDs');
                    }
                    if (!imageIdResults || imageIdResults.length === 0) {
                        console.log('No image_id found for imageData IDs:', imageDataIds);
                        // Cleanup before sending response
                        fs.unlink(req.file.path, (unlinkErr) => {
                            if (unlinkErr) console.error(`⚠️ Error deleting image file: ${req.file.path}`);
                        });
                        fs.unlink(jsonFilePath, (unlinkErr) => {
                            if (unlinkErr) console.error(`⚠️ Error deleting JSON file: ${jsonFilePath}`);
                        });
                        return res.send([]);
                    }

                    const imageIds = imageIdResults.map(r => r.image_id).filter(id => id !== null);
                    console.log('Mapped image IDs from imageData:', imageIds);

                    if (imageIds.length === 0) {
                        console.log('No valid image IDs after mapping');
                        // Cleanup before sending response
                        fs.unlink(req.file.path, (unlinkErr) => {
                            if (unlinkErr) console.error(`⚠️ Error deleting image file: ${req.file.path}`);
                        });
                        fs.unlink(jsonFilePath, (unlinkErr) => {
                            if (unlinkErr) console.error(`⚠️ Error deleting JSON file: ${jsonFilePath}`);
                        });
                        return res.send([]);
                    }

                    // Now fetch images and their IDs using the mapped image_ids
                    db.query('SELECT id, image FROM images WHERE id IN (?)', [imageIds], (err, results) => {
                        if (err) {
                            console.error('Database error (fetching images):', err);
                            // Cleanup before sending response
                            fs.unlink(req.file.path, (unlinkErr) => {
                                if (unlinkErr) console.error(`⚠️ Error deleting image file: ${req.file.path}`);
                            });
                            fs.unlink(jsonFilePath, (unlinkErr) => {
                                if (unlinkErr) console.error(`⚠️ Error deleting JSON file: ${jsonFilePath}`);
                            });
                            return res.status(500).send('Error retrieving matched images');
                        }
                        // console.log('Database results:', results);
                        if (!results || results.length === 0) {
                            console.log('No images found in database for IDs:', imageIds);
                            // Cleanup before sending response
                            fs.unlink(req.file.path, (unlinkErr) => {
                                if (unlinkErr) console.error(`⚠️ Error deleting image file: ${req.file.path}`);
                            });
                            fs.unlink(jsonFilePath, (unlinkErr) => {
                                if (unlinkErr) console.error(`⚠️ Error deleting JSON file: ${jsonFilePath}`);
                            });
                            return res.send([]);
                        }
                        const imageDataWithIds = results.map(r => {
                            if (!r.image) {
                                console.warn('No image data for result:', r);
                                return null;
                            }
                            return {
                                id: r.id,
                                data: r.image.toString('base64')
                            };
                        }).filter(item => item !== null);
                        // console.log('Images with IDs to send:', imageDataWithIds);
                        // Cleanup before sending response
                        fs.unlink(req.file.path, (unlinkErr) => {
                            if (unlinkErr) console.error(`⚠️ Error deleting image file: ${req.file.path}`);
                        });
                        fs.unlink(jsonFilePath, (unlinkErr) => {
                            if (unlinkErr) console.error(`⚠️ Error deleting JSON file: ${jsonFilePath}`);
                        });
                        res.send(imageDataWithIds);
                        console.log('Response sent successfully');
                    });
                });
            } else {
                // Cleanup before sending response
                fs.unlink(req.file.path, (unlinkErr) => {
                    if (unlinkErr) console.error(`⚠️ Error deleting image file: ${req.file.path}`);
                });
                fs.unlink(jsonFilePath, (unlinkErr) => {
                    if (unlinkErr) console.error(`⚠️ Error deleting JSON file: ${jsonFilePath}`);
                });
                res.send([]);
            }
        } catch (e) {
            console.error('JSON parsing error:', e.message);
            // Cleanup before sending response
            fs.unlink(req.file.path, (unlinkErr) => {
                if (unlinkErr) console.error(`⚠️ Error deleting image file: ${req.file.path}`);
            });
            fs.unlink(jsonFilePath, (unlinkErr) => {
                if (unlinkErr) console.error(`⚠️ Error deleting JSON file: ${jsonFilePath}`);
            });
            res.status(500).send('Error processing Python output');
        }
    });
});

// for findYourself page
app.get('/find', (req, res) => {
    res.sendFile(path.join(__dirname, '../website/findYourself.html'));
});

// for videos page
app.get('/video', (req, res) => {
    res.sendFile(path.join(__dirname, '../website/videos.html'));
});

// API routes
app.use('/', require('./routes/imageRoutes'));
app.use('/video', require('./routes/videoRoutes'));
app.use('/auth', require('./routes/authRoutes'));
app.use('/clients', require('./routes/clientRoutes'));
app.use('/event', require('./routes/eventRoutes'));
app.use('/plan', require('./routes/planRoutes'));
app.use('/carousel', require('./routes/carouselRoutes'));

app.use('/client-dashboard', require('./routes/clientDashboard'))
app.use('/super-admin-dashboard', require('./routes/superAdminDashboard'))




const uploadsDir = path.join(__dirname, 'Uploads');
if (fs.existsSync(uploadsDir)) {
    fs.readdirSync(uploadsDir).forEach(file => {
        const filePath = path.join(uploadsDir, file);
        try {
            fs.unlinkSync(filePath);
            console.log(`Deleted residual file: ${filePath}`);
        } catch (err) {
            console.error(`Error deleting file ${filePath}:`, err);
        }
    });
}
app.listen(3000, () => console.log('🚀 Server running on port 3000'));