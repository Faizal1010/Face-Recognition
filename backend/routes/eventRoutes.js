const express = require('express')
const { addEvent, getAllEvents, deleteEvent, getEventsByClientId } = require('../controllers/eventController')
const router = express.Router()

router.post('/add-event', addEvent)

router.get('/fetch-all-event', getAllEvents)

router.delete('/delete-event/:id', deleteEvent)

router.get('/client-events/:client_id', getEventsByClientId )

module.exports = router