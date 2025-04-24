const express = require('express');
const { createPlan, getAllPlans, deletePlan, getPlanById } = require('../controllers/planController');

const router = express.Router();

router.post('/create-plan', createPlan);
router.get('/fetch-all-plans', getAllPlans);
router.delete('/delete-plan/:id', deletePlan);
router.get('/fetch-plan/:id', getPlanById);

module.exports = router;