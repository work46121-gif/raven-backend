require('dotenv').config();
require('./server');
require('./bot');
```
Then commit it.

2. **Delete or edit the `Procfile`** — click on it and check what's inside. If it says `web: node server.js` that's overriding everything. Either delete it or change it to:
```
web: node index.js
