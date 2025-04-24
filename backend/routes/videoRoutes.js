const express = require('express');
const router = express.Router();
const videoController = require('../controllers/videoController');

// Existing Routes
router.post('/add-videos', videoController.storeVideos);
router.get('/all-videos', videoController.getVideos);
router.delete('/delete-videos', videoController.deleteVideo);
router.get('/get-video-labels/:eventId', videoController.getVideoLabels);

// New Routes
router.put('/update-video-labels', videoController.updateVideoLabels);
// router.delete('/delete-selected-videos', videoController.deleteSelectedVideos);
router.post('/get-videos-by-labels', videoController.getVideosByLabels);
router.delete('/delete-videos-by-ids', videoController.deleteVideosByIds);
router.put('/update-video-labels-by-id', videoController.updateVideoLabelsById);

router.get('/all-videos-no-client', videoController.getVideosNoClient);
module.exports = router;