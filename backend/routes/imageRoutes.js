const express = require('express');
const router = express.Router();
const imageController = require('../controllers/imageController');

router.get('/images', imageController.getImages);
router.delete('/delete-images', imageController.deleteImage);
router.get('/get-labels/:eventId', imageController.getLabels)




router.post('/update-label', imageController.updateLabels)
router.post('/remove-multiple', imageController.deleteSelectedImages)

router.post('/label-based-fetch', imageController.getImagesByLabels)


router.delete('/id-based-image-delete', imageController.deleteImagesByIds)
router.post('/id-based-label-change', imageController.updateLabelsById)

module.exports = router;