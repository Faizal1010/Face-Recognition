const mysql = require('mysql2');

// DB Connection
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'zxcvbnm1010@',
  database: 'face_recognition'
});


exports.getImages = (req, res) => {
  let { page, limit } = req.query;
  const pageNum = parseInt(page) || 1;
  const pageSize = parseInt(limit) || 10;
  const offset = (pageNum - 1) * pageSize;

  db.query('SELECT id, image FROM images ORDER BY id ASC LIMIT ? OFFSET ?', [pageSize, offset], (err, results) => {
    if (err) {
      console.error('Error fetching images:', err);
      return res.status(500).json({ error: 'Error fetching images' });
    }

    const images = results.map(r => ({
      id: r.id,
      data: Buffer.from(r.image).toString('base64')
    }));

    // Get total count for pagination metadata
    db.query('SELECT COUNT(*) AS total FROM images', (err, countResult) => {
      if (err) {
        console.error('Error fetching total count:', err);
        return res.status(500).json({ error: 'Error fetching total count' });
      }

      const total = countResult[0].total;
      const totalPages = Math.ceil(total / pageSize);

      res.json({ images, page: pageNum, totalPages, total });
    });
  });
};

exports.deleteImage = (req, res) => {
  const { id } = req.params;
  console.log("Deleting ID:", id);

  // First, delete all references in imageData before deleting from images
  db.query('DELETE FROM imageData WHERE image_id = ?', [id], (err, result) => {
    if (err) {
      console.error("Error deleting image data:", err);
      return res.status(500).send('Error deleting image data');
    }

    console.log("Deleted from imageData:", result.affectedRows);

    // Now, delete from images (parent table)
    db.query('DELETE FROM images WHERE id = ?', [id], (err, result) => {
      if (err) {
        console.error("Error deleting image:", err);
        return res.status(500).send('Error deleting image');
      }

      console.log("Deleted from images:", result.affectedRows);
      res.send('Image deleted successfully');
    });
  });
};

exports.getLabels = (req, res) => {
  db.query('SELECT label FROM images', (err, results) => {
    if (err) {
      console.error('Error fetching labels:', err);
      return res.status(500).json({ error: 'Error fetching labels' }); // Send JSON error response
    }
    
    // Extract the labels from the results
    const labels = results.map(r => r.label);
    
    res.json(labels); // Send the list of labels as a JSON response
  });
};

exports.updateLabels = (req, res) => {
  const { ids, label } = req.body;
  console.log("ids : ",ids)
  console.log("label : ",label)

  if (!ids || ids.length === 0) {
    return res.status(400).json({ error: 'No image IDs provided' });
  }

  db.query('UPDATE images SET label = ? WHERE id IN (?)', [label, ids], (err, result) => {
    if (err) {
      console.error('Error updating labels:', err);
      return res.status(500).json({ error: 'Error updating labels' });
    }

    res.json({ message: 'Labels updated successfully', affectedRows: result.affectedRows });
  });
};

exports.deleteSelectedImages = (req, res) => {
  console.log("handler hit")
  const { ids } = req.body;
  console.log("imageIds", ids)

  if (!ids || ids.length === 0) {
    return res.status(400).json({ error: 'No image IDs provided' });
  }

  db.query('DELETE FROM imageData WHERE image_id IN (?)', [ids], (err, result) => {
    if (err) {
      console.error('Error deleting image data:', err);
      return res.status(500).json({ error: 'Error deleting image data' });
    }

    db.query('DELETE FROM images WHERE id IN (?)', [ids], (err, result) => {
      if (err) {
        console.error('Error deleting images:', err);
        return res.status(500).json({ error: 'Error deleting images' });
      }

      res.json({ message: 'Images deleted successfully', affectedRows: result.affectedRows });
    });
  });
};

exports.getImagesByLabels = (req, res) => {
  const { labels, page, limit } = req.body;
  console.log("Selected labels:", labels);

  if (!labels || labels.length === 0) {
    return res.status(400).json({ error: "No labels provided" });
  }

  const pageNum = parseInt(page) || 1;
  const pageSize = parseInt(limit) || 10;
  const offset = (pageNum - 1) * pageSize;

  db.query('SELECT id, image FROM images WHERE label IN (?) ORDER BY id ASC LIMIT ? OFFSET ?', [labels, pageSize, offset], (err, results) => {
    if (err) {
      console.error("Error fetching images by labels:", err);
      return res.status(500).json({ error: "Error fetching images" });
    }

    const images = results.map(r => ({
      id: r.id,
      data: Buffer.from(r.image).toString('base64')
    }));

    // Get total count for pagination
    db.query('SELECT COUNT(*) AS total FROM images WHERE label IN (?)', [labels], (err, countResult) => {
      if (err) {
        console.error("Error fetching total count:", err);
        return res.status(500).json({ error: "Error fetching total count" });
      }

      const total = countResult[0].total;
      const totalPages = Math.ceil(total / pageSize);

      res.json({ images, page: pageNum, totalPages, total });
    });
  });
};