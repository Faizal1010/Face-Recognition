const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();

const upload = multer({ dest: 'uploads/', limits: { files: 500 } });

app.use(cors({ origin: "*" }));
app.use(express.static(path.join(__dirname, '../client')));
app.use(express.json());

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'zxcvbnm1010@',
    database: 'face_recognition'
});

// Helper function to run Python scripts
function runPythonScript(scriptPath, args, callback) {
    const fullPath = path.join(__dirname, 'scripts', scriptPath);
    const pythonProcess = spawn('py', [fullPath, ...args]);
    let output = '';

    pythonProcess.stdout.on('data', (data) => {
        const rawData = data.toString().trim();
        console.log('Raw data from Python:', rawData);

        // Parse the raw output as JSON
        try {
            const parsedData = JSON.parse(rawData);
            
            if (parsedData.status === 'match_found' && Array.isArray(parsedData.matched_images)) {
                callback(null, parsedData.matched_images);  // Pass matched images
            } else {
                callback('Unexpected JSON format');
            }
        } catch (e) {
            console.error('Invalid JSON output:', rawData);
            callback('Invalid JSON output');
        }
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    pythonProcess.on('close', (code) => {
        if (code !== 0) {
            callback(`Python script exited with code ${code}`);
        }
    });
}


app.post('/upload', upload.array('image', 500), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).send('No files uploaded');
    }

    const { label } = req.body;
    if (!label) {
        return res.status(400).send('Label is required');
    }

    const filePaths = req.files.map(file => path.join(__dirname, file.path));

    runPythonScript('extract_embeddings.py', [...filePaths, label], (err, output) => {
        if (err) {
            req.files.forEach(file => fs.unlinkSync(path.join(__dirname, file.path)));
            return res.status(500).send('Error processing images');
        }

        res.send(output);

        req.files.forEach(file => {
            fs.unlink(path.join(__dirname, file.path), (unlinkErr) => {
                if (unlinkErr) {
                    console.error(`Error deleting file: ${file.path}`);
                }
            });
        });
    });
});

app.post('/recognize', upload.single('image'), (req, res) => {
    const filePath = path.join(__dirname, req.file.path);
    const selectedLabels = JSON.parse(req.body.labels || '[]');
    console.log('Selected Labels:', selectedLabels);
    
    runPythonScript('compare_faces.py', [filePath, JSON.stringify(selectedLabels)], (err, output) => {
        if (err) return res.status(500).send('Error recognizing image');
        
        const placeholders = output.map(() => '?').join(',');
        const sql = `SELECT image FROM images WHERE id IN (SELECT image_id FROM imageData WHERE id IN (${placeholders}))`;

        console.log('SQL Query:', sql);

        db.query(sql, output, (err, results) => {
            if (err) {
                console.error('Error executing query:', err);
                return res.status(500).send('Error fetching images');
            }

            if (results.length === 0) return res.status(404).send('No images found');
            
            res.send(results.map(r => r.image.toString('base64')));

            fs.unlinkSync(filePath);
        });
    });
});


app.get('/user', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/findYourself.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/admin.html'));
});

app.use('/', require('./routes/imageRoutes'));
app.use('/auth', require('./routes/authRoutes'))


app.listen(3000, () => console.log('Server running on port 3000'));