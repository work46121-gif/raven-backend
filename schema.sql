-- RAVEN Database Schema
-- Run this in Supabase SQL Editor

-- Bills table
CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  creator_phone TEXT NOT NULL,
  name TEXT NOT NULL,
  total NUMERIC(10,2) NOT NULL,
  per_person NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT DEFAULT 'active'
);

-- Participants table
CREATE TABLE participants (
  id SERIAL PRIMARY KEY,
  bill_id TEXT REFERENCES bills(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  paid BOOLEAN DEFAULT FALSE,
  paid_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(bill_id, phone)
);

-- Messages log (optional but useful for debugging)
CREATE TABLE message_log (
  id SERIAL PRIMARY KEY,
  from_phone TEXT NOT NULL,
  body TEXT NOT NULL,
  received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX idx_participants_phone ON participants(phone);
CREATE INDEX idx_participants_bill ON participants(bill_id);
CREATE INDEX idx_bills_creator ON bills(creator_phone);
