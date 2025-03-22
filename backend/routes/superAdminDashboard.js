const express = require('express')
const path = require('path');

const router = express.Router()

router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../super admin dashboard/index.html'))
})

router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../../super admin dashboard/page-account-login.html'))
})

router.get('/customers', (req, res) => {
    res.sendFile(path.join(__dirname, '../../super admin dashboard/customers.html'))
})

router.get('/add-customers', (req, res) => {
    res.sendFile(path.join(__dirname, '../../super admin dashboard/add-customers.html'))
})

module.exports = router