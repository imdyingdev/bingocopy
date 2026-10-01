/**
 * Application Constants
 * 
 * This file contains configuration constants for group-specific command restrictions.
 */

// Keep a command restriction map but drop the legacy hardwired group gate.
// Actual group allow-listing is now driven by the group-config approval flow.
const SUPER_ADMIN_IDS = [
  8442877660,
  5814751810,
  1649257876,
];

const GLOBAL_GROUP_ID = -1004308985137;

const GROUP_SPECIFIC_COMMANDS = {
  bola: [],
  pondo: [],
  start: [],
  bingostart: [],
};

module.exports = {
  GROUP_SPECIFIC_COMMANDS,
  SUPER_ADMIN_IDS,
  GLOBAL_GROUP_ID,
};