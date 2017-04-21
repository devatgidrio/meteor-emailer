var MailTime, mailQueue,
  bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

mailQueue = new Mongo.Collection("__mailQueue__");

mailQueue._ensureIndex({
  uid: 1,
  sendAt: 1,
  isSent: 1,
  tries: 1
}, {
  background: true
});

mailQueue.deny({
  insert: function() {
    return true;
  },
  update: function() {
    return true;
  },
  remove: function() {
    return true;
  }
});


/*
@locus Server
@class MailTime
@description Nice wrapper around Email
 */

MailTime = (function() {

  /*
  @constructor
  @param settings {Object} - Connection, sending and other settings
  @description For more info about constrictor options see README.md and docs
   */
  var renderReplace;

  function MailTime(settings) {
    if (settings == null) {
      settings = {};
    }
    this.compileBody = bind(this.compileBody, this);
    this.send = bind(this.send, this);
    this.queueTry = bind(this.queueTry, this);
    this.queueAdd = bind(this.queueAdd, this);
    check(settings, Object);
    if (Object.keys(settings).length) {
      this.login = settings.login, this.host = settings.host, this.connectionUrl = settings.connectionUrl, this.accountName = settings.accountName, this.verbose = settings.verbose, /*this.logging = settings.logging,*/ this.intervalTime = settings.intervalTime, this.saveHistory = settings.saveHistory, this.retryTimes = settings.retryTimes, this.template = settings.template, this.templateId = settings.templateId;
    }
    check(this.login, String);
    check(this.host, String);
    this.queue = {};
    this.callbacks = {};
    if (this.connectionUrl == null) {
      this.connectionUrl = process.env.MAIL_URL;
    }
    check(this.connectionUrl, String);
    if (this.accountName == null) {
      this.accountName = this.login;
    }
    if (this.verbose == null) {
      this.verbose = false;
    }
    if (this.intervalTime == null) {
      this.intervalTime = 60;
    }
    if (this.saveHistory == null) {
      this.saveHistory = false;
    }
    if (this.retryTimes == null) {
      this.retryTimes = 50;
    }
    if (this.templateId == null) {
      this.templateId = false;
    }
    if (this.template == null) {
      this.template = false;
    }
    this.uid = SHA256(this.connectionUrl + this.accountName + this.login);
    process.env.MAIL_URL = this.connectionUrl || process.env.MAIL_URL;
    Meteor.setInterval(this.queueTry, this.intervalTime * 1000);
  }

  MailTime.prototype.queueAdd = function(opts, callback) {
    var _id, cbKey;
    cbKey = false;
    if (callback) {
      cbKey = SHA256("" + opts.to + opts.subject + opts.sendAt + this.uid);
      this.callbacks[cbKey] = callback;
    }
    _id = mailQueue.insert({
      uid: this.uid,
      opts: opts,
      templateId: opts.templateId,
      to: opts.to,
      subject: opts.subject,
      template: opts.template,
      sendAt: opts.sendAt,
      isSent: false,
      tries: 0,
      callback: cbKey
    });
    this.queueTry(_id);
  };

  MailTime.prototype.queueTry = function(_id) {
    var _self, emailsToSend;
    if (_id == null) {
      _id = false;
    }
    if (_id) {
      emailsToSend = mailQueue.find(_id);
    } else {
      emailsToSend = mailQueue.find({
        uid: this.uid,
        sendAt: {
          $lte: new Date()
        },
        isSent: false,
        tries: {
          $lt: this.retryTimes
        }
      });
    }
    if (emailsToSend && emailsToSend.count() > 0) {
      _self = this;
      return emailsToSend.forEach(function(letter) {
        mailQueue.update({
          _id: letter._id
        }, {
          $set: {
            isSent: true
          }
        }, function() {
          Meteor.defer(function() {
            var e, ref, ref1, ref2, ref3, ref4;
            try {
              Email.send({
                from: !!~_self.login.indexOf('@') ? "<" + _self.login + "> " + _self.accountName : "<" + _self.login + "@" + _self.host + "> " + _self.accountName,
                to: letter.to,
                cc: (ref = letter.opts) != null ? ref.cc : void 0,
                bcc: (ref1 = letter.opts) != null ? ref1.bcc : void 0,
                replyTo: (ref2 = letter.opts) != null ? ref2.replyTo : void 0,
                subject: letter.subject.replace(/<(?:.|\n)*?>/gm, ''),
                html: _self.compileBody(letter.opts, letter.template)
              },function(error,response){
                console.log(error,response);
              });
              //if (_self.logging.enabled) {
                if (letter.callback && ((ref3 = _self.callbacks) != null ? ref3[letter.callback] : void 0)) {
                  _self.callbacks[letter.callback](null, true, letter.to, letter._id);
                  delete _self.callbacks[letter.callback];
                }
                if (!_self.saveHistory) {
                  mailQueue.remove({
                    _id: letter._id
                  });
                }
                if (_self.verbose) {
                  console.info("Email was successfully sent to " + letter.to);
                }
              //}
            } catch (_error) {
              console.log(_error,'1111');
              //if (_self.logging.enabled) {
                e = _error;
                if (_self.verbose) {
                  console.info("Email wasn't sent to " + letter.to, e);
                }
                mailQueue.update({
                  _id: letter._id
                }, {
                  $set: {
                    isSent: false
                  },
                  $inc: {
                    tries: 1
                  }
                });
                if (letter.callback && ((ref4 = _self.callbacks) != null ? ref4[letter.callback] : void 0)) {
                  _self.callbacks[letter.callback]({
                    error: e
                  }, false, letter.to, letter._id);
                }
                if (_self.verbose) {
                  console.info("Trying to send email to " + letter.to + " again for " + (++letter.tries) + " time(s)");
                }
              }
            //}
          });
        });
      });
    }
  };


  /*
  @locus Server
  @memberOf MailTime
  @name send
  @param  opts  {Object}  - Object with next properties:
  @param opts.recipient {String}   - E-mail address of recipient
  @param opts.subject   {String}   - Letter Subject (plain-text or HTML)
  @param opts.message   {String}   - Letter Message (plain-text or HTML)
  @param opts.template  {String}   - [OPTIONAL] Plain-text or HTML with Spacebars-like placeholders
  @param opts.sendAt    {Date}     - [OPTIONAL] When email should be sent (current time - by default)
  @param opts[any]      {String}   - Any other property as a String which will be used as template helpers
  @param callback  {Function} - Callback function: `function(error, success, recipientEmail)`
  @returns {undefined}
   */

  MailTime.prototype.send = function(opts, callback) {
    if (callback == null) {
      callback = false;
    }
    if (opts.sendAt == null) {
      opts.sendAt = new Date;
    }
    check(opts, Object);
    check(opts.to, String);
    check(opts.cc, Match.Optional(String));
    check(opts.bcc, Match.Optional(String));
    check(opts.replyTo, Match.Optional(String));
    check(opts.subject, String);
    check(opts.message, String);
    check(opts.sendAt, Date);
    this.queueAdd(opts, callback);
  };


  /*
  @locus Server
  @memberOf MailTime
  @name compileBody
  @param  helpers  {Object}  - Configuration Object with next properties:
  @param  helpers.subject  {String}  - Letter subject
  @param  helpers.message  {String}  - Message text, letter body
  @param  helpers.lang     {String}  - [OPTIONAL] Language
  @param  template {String}  - [OPTIONAL] Plain-text or HTML with Spacebars/Blaze-like placeholders
  @returns {String}
   */

  MailTime.prototype.compileBody = function(helpers, template) {
    var tmplt;
    if (helpers == null) {
      helpers = {};
    }
    if (template) {
      tmplt = template;
    } else {
      tmplt = !this.template ? this.basicHTMLTempate : this.template;
    }
    return renderReplace(tmplt, helpers);
  };


  /*
  @locus Server
  @memberOf MailTime
  @name renderReplace
  @param  string  {String}  - Template with Spacebars/Blaze-like placeholders
  @param  replacements  {Object}  - Blaze-like helpers Object
  @returns {String}
   */

  renderReplace = function(string, replacements) {
    var html, i, j, len, len1, matchHTML, matchStr, str;
    matchHTML = string.match(/\{{3}\s?([a-zA-Z0-9\-\_]+)\s?\}{3}/g);
    if (matchHTML) {
      for (i = 0, len = matchHTML.length; i < len; i++) {
        html = matchHTML[i];
        if (replacements[html.replace("{{{", "").replace("}}}", "").trim()]) {
          string = string.replace(html, replacements[html.replace("{{{", "").replace("}}}", "").trim()]);
        }
      }
    }
    matchStr = string.match(/\{{2}\s?([a-zA-Z0-9\-\_]+)\s?\}{2}/g);
    if (matchStr) {
      for (j = 0, len1 = matchStr.length; j < len1; j++) {
        str = matchStr[j];
        if (replacements[str.replace("{{", "").replace("}}", "").trim()]) {
          string = string.replace(str, replacements[str.replace("{{", "").replace("}}", "").trim()].replace(/<(?:.|\n)*?>/gm, ''));
        }
      }
    }
    return string;
  };

  MailTime.prototype.basicHTMLTempate = '<html lang="{{lang}}" style="padding:10px 0px;margin:0px;width:100%;background-color:#ececec;"><head> <meta charset="utf-8"> <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1"> <title>{{{subject}}}</title> <meta name="viewport" content="width=device-width"> <style type="text/css"> html{font-size:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}::-moz-selection{background:rgba(0,0,0,0.2);color:#fff;text-shadow:none}::selection{background:rgba(0,0,0,0.2);color:#fff;text-shadow:none}a:focus{outline:0}a:hover,a:active{outline:0}abbr[title]{border-bottom:1px dotted}b,strong{font-weight:bold}small{font-size:85%}sub,sup{font-size:75%;line-height:0;position:relative;vertical-align:baseline}sup{top:-0.5em}sub{bottom:-0.25em}ul,ol{margin:1em 0;padding:0 0 0 40px}table{border-collapse:collapse;border-spacing:0}td{vertical-align:top}body{font-family:"Lucida Grande",Helvetica,Arial,Verdana,sans-serif;font-size:13px;color:#2b2b2b;line-height:20px;background-color:#ececec;text-shadow:1px 1px rgba(255,255,255,.95)}.wrapper{max-width:546px;margin:26px auto;background-color:#fafafa;-webkit-border-radius:6px;-moz-border-radius:6px;border-radius:6px;box-shadow:0px 1px 1px #ccc;box-shadow:0px 1px 5px rgba(0, 0, 0, 0.1);padding:5px;border:1px solid rgba(0,0,0,0.2);}a,a:visited{color:#b0b3b9}a:hover{color:#b0b3b9}.footer{text-align:center;font-size:11px;color:#b0b3b9;line-height:14px;text-shadow:1px 1px #fff;text-shadow:1px 1px rgba(255,255,255,.5)}.footer a,.footer a:visited{color:#b0b3b9;font-weight:bold}.main{padding:15px;-webkit-border-radius:8px;-moz-border-radius:8px;border-radius:8px;box-shadow:inset 0px 0px 1px #ccc;box-shadow:inset 0px 0px 1px rgba(0,0,0,0.4);border:1px solid rgba(0,0,0,0.2);}h2{font-weight:200; color:#222;}hr{display:block;height:1px;border:0;border-top:1px solid #ccc;border-top:1px solid rgba(0,0,0,0.2);margin:1em -16px;padding:0}</style></head><body style="padding:10px 0px;margin:0px;width:100%;background-color:#ececec;"> <div style="font-family:\'Lucida Grande\',Helvetica,Arial,Verdana,sans-serif;font-size:13px;color:#2b2b2b;line-height:20px;background-color:#ececec;text-shadow:1px 1px rgba(255,255,255,.95);"> <div class="wrapper" style="max-width:546px;margin:26px auto;background-color:#fafafa;-webkit-border-radius:6px;-moz-border-radius:6px;border-radius:6px;box-shadow:0px 1px 1px #ccc;box-shadow:0px 1px 5px rgba(0, 0, 0, 0.1);padding:5px;border:1px solid rgba(0,0,0,0.2);"> <div class="main" style="padding:15px;-webkit-border-radius:8px;-moz-border-radius:8px;border-radius:8px;box-shadow:inset 0px 0px 1px #ccc;box-shadow:inset 0px 0px 1px rgba(0,0,0,0.4);border:1px solid rgba(0,0,0,0.2);"> <table bgcolor="fafafa" font-color="2b2b2b" width="100%" cellspacing="0" celladding="0" border="0"> <tbody> <tr> <td> <h2 style="font-weight:200">{{{subject}}}</h2> <hr style="display:block;height:1px;border:0;border-top:1px solid #ccc;border-top:1px solid rgba(0,0,0,0.2);margin:1em -16px;padding:0"> </td></tr><tr> <td> <p>{{{message}}}</p></td></tr></tbody> </table> </div></div><div class="footer" align="center" width="100%" style="font-size:11px;color:#b0b3b9;line-height:14px;text-shadow:1px 1px #fff;text-shadow:1px 1px rgba(255,255,255,.5)"> <table bgcolor="ececec" color="b0b3b9" height="100%" width="100%" cellspacing="0" celladding="0" border="0"> <tbody> <tr> <td align="center"> All rights belongs to site owner.<br/> <a style="color:#b0b3b9;font-weight:bold" href="{{url}}">{{appname}}</a> </td></tr></tbody> </table> </div></div></body></html>';

  return MailTime;

})();


/*
Export the MailTime class
 */

Meteor.Mailer = MailTime;

export { MailTime };
export { mailQueue };