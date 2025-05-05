const express = require('express')
const path = require('path');

const router = express.Router()

router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client dashboard/index.html'))
})

router.get('/uploaded-images', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client dashboard/uploaded-images.html'))
})

router.get('/uploaded-videos', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client dashboard/uploaded-videos.html'))
})

router.get('/events', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client dashboard/page-categories.html'))
})

router.get('/add-images', (req, res) => {
        res.sendFile(path.join(__dirname, '../../client dashboard/add-images.html'))
})

router.get('/add-videos', (req, res) => {
        res.sendFile(path.join(__dirname, '../../client dashboard/add-videos.html'))
})

router.get('/carousel', (req, res) =>{
    res.sendFile(path.join(__dirname, '../../client dashboard/carousel.html'))
})

module.exports = router