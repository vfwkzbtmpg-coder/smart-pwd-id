// Serverless entry point for Vercel.
//
// Every request under /api is routed here by Vercel's file-system routing
// (the [...path] brackets make this a catch-all), and the real request path
// is passed through untouched, so the Express router in server/server.js
// matches exactly the same routes it does locally.
//
// The public website itself is served as static files from public/, which
// is why this file only has to deal with the API.
module.exports = require('../server/server');
