-- Interview Manager — ensure the owner account is an admin
-- Run AFTER 0028_notify_resilient.sql.
--
-- The owner email is admin by app logic (isAdminUser) regardless of role, but
-- set the DB role too so role-filtered queries/triggers (admin notifications,
-- the interviewers list, etc.) include this account. They can still use the
-- candidate side — access to /candidate/* isn't restricted to candidates.

update public.profiles
set role = 'admin'
where lower(email) = 'victorbarbuta54@gmail.com';
