// Whichever login attendance-check.ts is acting as just now.
module.exports = {
  currentUser: async () => globalThis.__attendanceUser,
};
