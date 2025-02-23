const express = require('express');
const router = express.Router();
const imageController = require('../controllers/imageController');

router.get('/images', imageController.getImages);
router.delete('/delete/:id', imageController.deleteImage);
router.get('/get-labels', imageController.getLabels)




router.post('/update-label', imageController.updateLabels)
router.post('/remove-multiple', imageController.deleteSelectedImages)

router.post('/label-based-fetch', imageController.getImagesByLabels)

module.exports = router;
