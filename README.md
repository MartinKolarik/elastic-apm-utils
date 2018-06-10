# elastic-apm-utils

Utilities for Elastic APM

## Installation

```
$ npm install elastic-apm-utils
```

## API

### APM

#### apmUtils.apm.filter({ keepRequest, keepResponse, keepSocket })

Filters `request` and `response` properties.

```js
apmClient.addFilter(apmUtils.apm.filter({
    // list of request headers to keep, optional
    keepRequest: [ 'referer', 'user-agent' ], 

    // list of response headers to keep, optional
    keepResponse: [], 

    // list of socket properties to keep, optional
    keepSocket: [], 
}));
```

## Express integration

#### apmUtils.express.middleware(apmClient, { setAddress, setOrigin })

Returns an express middleware. 

```js
server.use(apmUtils.express.middleware(apmCient, {
    // set remote IP address as a tag to allow filtering in Kibana
    setAddress: true,
    
    // set request origin / referrer hostname as a tag to allow filtering in Kibana
    setOrigin: true,
}));
```

## Koa integration

#### apmUtils.koa.middleware(apmClient, { prefix, setAddress, setOrigin, setRouteName })

Returns an express middleware. 

```js
server.use(apmUtils.koa.middleware(apmCient, {
    // a prefix for all transaction names, only used if setRouteName = true
    prefix: '',
    
    // set remote IP address as a tag to allow filtering in Kibana
    setAddress: true,
    
    // set request origin / referrer hostname as a tag to allow filtering in Kibana
    setOrigin: true,
    
    // more accurate route names when using koa-router
    setRouteName: true,
}));
```


## License
Copyright (c) 2018 Martin Kolárik. Released under the MIT license.
