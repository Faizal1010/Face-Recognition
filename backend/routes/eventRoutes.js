const express = require('express')
const { addEvent, getAllEvents, deleteEvent, getEventsByClientId, checkEventExists } = require('../controllers/eventController')
const router = express.Router()

router.post('/add-event', addEvent)

router.get('/fetch-all-event', getAllEvents)

router.delete('/delete-event/:id', deleteEvent)

router.get('/client-events/:client_id', getEventsByClientId )

router.head('/check-event/:event_code', checkEventExists )

module.exports = router 