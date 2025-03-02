const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const uploadDir = path.join(__dirname, 'uploads');

const upload = multer({ 
    dest: uploadDir, 
    limits: { files: 500, fieldSize: 1024 * 1024 * 100 } // Increased limits
});

app.use(cors({ origin: "*" }));
app.use(express.static(path.join(__dirname, '../website')));
app.use(express.json({ limit: "500gb" }));
app.use(express.urlencoded({ extended: true, limit: "500gb" }));

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'zxcvbnm1010@',
    database: 'face_recognition'
});

// Helper function to run Python script safely
function runPythonScript(scriptPath, jsonFilePath, callback) {
    const fullPath = path.join(__dirname, 'scripts', scriptPath);
    console.log(`⚡ Running Python script: ${fullPath} with JSON: ${jsonFilePath}`);

    try {
        const pythonProcess = spawn('python', [fullPath, jsonFilePath]);

        let output = '';
        let errorOutput = '';

        pythonProcess.stdout.on('data', (data) => {
            const rawData = data.toString().trim();
            console.log(`📜 Python Output: ${rawData}`);
            output += rawData;
        });

        pythonProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
            console.error(`❌ Python Error: ${data}`);
        });

        pythonProcess.on('close', (code) => {
            console.log(`🔴 Python script exited with code ${code}`);

            if (code !== 0 || errorOutput) {
                return callback(`Python script failed with code ${code}.\nError: ${errorOutput || 'Unknown error'}`);
            }

            try {
                const parsedData = JSON.parse(output);
                callback(null, parsedData);
            } catch (e) {
                console.error(`❌ JSON Parsing Error: ${output}`);
                callback('Invalid JSON output from Python script.');
            }
        });

    } catch (err) {
        console.error(`❌ Failed to spawn Python script: ${err}`);
        callback('Python execution failed');
    }
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

    // Run Python script safely
    process.nextTick(() => {
        runPythonScript('extract_embeddings.py', jsonFilePath, (err, output) => {
            if (err) {
                console.error(`❌ Python script error: ${err}`);
                req.files.forEach(file => fs.unlinkSync(file.path));
                fs.unlinkSync(jsonFilePath);
                return res.status(500).send('Error processing images');
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
    if (!req.file) {
        return res.status(400).send('No file uploaded');
    }

    const filePath = path.join(__dirname, req.file.path);
    const selectedLabels = JSON.parse(req.body.labels || '[]');
    const { client_id } = req.body;

    if (!client_id || selectedLabels.length === 0) {
        return res.status(400).send('Client ID and at least one label are required');
    }

    console.log(`🖼️ Recognizing image: ${filePath}`);

    process.nextTick(() => {
        runPythonScript('compare_faces.py', [filePath, JSON.stringify(selectedLabels), client_id], (err, output) => {
            if (err) {
                console.error(`❌ Face recognition failed: ${err}`);
                return res.status(500).send('Error recognizing image');
            }

            if (!output || output.length === 0) {
                return res.status(404).send('No matching images found');
            }

            const placeholders = output.map(() => '?').join(',');
            const sql = `SELECT image FROM images WHERE id IN (SELECT image_id FROM imageData WHERE id IN (${placeholders}))`;

            db.query(sql, output, (err, results) => {
                if (err) {
                    console.error(`❌ Error executing query: ${err}`);
                    return res.status(500).send('Error fetching images');
                }

                if (results.length === 0) {
                    return res.status(404).send('No images found');
                }

                res.send(results.map(r => r.image.toString('base64')));

                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) console.error(`⚠️ Error deleting temp image: ${filePath}`);
                });
            });
        });
    });
});

// Serve frontend pages
app.get('/user', (req, res) => {
    res.sendFile(path.join(__dirname, '../website/findYourself.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../website/admin.html'));
});

// API routes
app.use('/', require('./routes/imageRoutes'));
app.use('/auth', require('./routes/authRoutes'));
app.use('/clients', require('./routes/clientRoutes'));
app.use('/event', require('./routes/eventRoutes'));

app.listen(3000, () => console.log('🚀 Server running on port 3000'));