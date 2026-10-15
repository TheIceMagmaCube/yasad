-- System groups always exist: everyone (signed in or not) and any signed-in user.
INSERT INTO `group` (`id`, `name`, `source`) VALUES ('system:everyone', 'everyone', 'system'), ('system:authenticated', 'authenticated', 'system');
