const express = require('express');
const { createPlan, getAllPlans, deletePlan, getPlanById, upgradePlan } = require('../controllers/planController');

const router = express.Router();

router.post('/create-plan', createPlan);
router.get('/fetch-all-plans', getAllPlans);
router.delete('/delete-plan/:id', deletePlan);
router.get('/fetch-plan/:id', getPlanById);

router.post('/upgrade-plan/:customerId', upgradePlan);


module.exports = router;