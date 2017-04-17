Package.describe({
  name: 'devatgidrio:meteor-emailer',
  version: '1.2.4',
  summary: 'Emails queue with schedule and support of HTML-Templates, and custom SMTP connection',
  git: 'https://github.com/devatgidrio/meteor-emailer',
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom('1.3');
  api.use(['mongo', 'check', 'sha', 'ecmascript', 'email'], 'server');
  api.mainModule('mailer.js', 'server');
  api.export('MailTime');
});