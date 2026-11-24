(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://fvyinioymlegzfhrahbt.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2eWluaW95bWxlZ3pmaHJhaGJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNzY1ODIsImV4cCI6MjEwMzY1MjU4Mn0.OfeEizyn3R3T5g1-Ry-6YQAYGwOc3V7pIA5Gg2S06QA';

  function getCreateClient() {
    if (global.supabase && typeof global.supabase.createClient === 'function') {
      return global.supabase.createClient;
    }
    if (typeof require === 'function') {
      try {
        var mod = require('@supabase/supabase-js');
        if (mod && typeof mod.createClient === 'function') return mod.createClient;
      } catch (_) {}
    }
    return null;
  }

  function install() {
    var createClient = getCreateClient();
    if (!createClient) return false;
    if (global.supabase && typeof global.supabase.auth === 'object') return true;
    try {
      global.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  install();
  global.__initSupabaseClient = install;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
