const express = require('express')
const { addClient, getClient, deleteClient, uploadProfile, getLatestClients, getClientById, getClientByCustomerId, getAdminDashboardData, verifyClient } = require('../controllers/clientController')
const router = express.Router()

router.post('/add-client', addClient)

router.get('/get-client', getClient)

router.delete('/delete-client/:id', deleteClient)

router.post('/upload-profile', uploadProfile)

router.get('/latest-Clients', getLatestClients)

router.get('/by-id-client/:id', getClientById)

//this handler is to get client by customer code(eg. CJH45P)
router.get('/code-client/:customerId', getClientByCustomerId)

router.get('/admin-data', getAdminDashboardData)

router.get('/verify/:token', verifyClient);

module.exports = router