# ts-loader-forcesupertransformer: typescript 'super' enforcer

Add a @forceSuperCall tag in a method's JSDoc, and all overrides must call super or an error will be thrown during compilation.  

## Installation

```
npm install --save-dev ts-loader-forcesupertransformer
```

In your webpack config file, include the following code:

```javascript
const forceSuperTransformer = require('ts-loader-forcesupertransformer');

module.exports = {
  // ...
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        options: {
          getCustomTransformers: (program) => ({
            before: [forceSuperTransformer(program)]
          })
        }
      }
    ]
  }
};
```

## Usage

To renew the transformer after every build, call the exported function with `null` (necessary if using 'watch'):

```javascript
module.exports = {
  // ...
  plugins:
    [
        {
            apply:(compiler) => 
            {
                compiler.hooks.done.tap('AfterBuildPlugin', (compilation) => 
                {
                    forceSuperTransformer(null);
                });
            }
        }
    ]
};
```

## Configuration

A custom JSDoc tag name can be provided:

```javascript
const transformer = forceSuperTransformer(program, 'customAttributeName');
```

If not provided, the name defaults to `forceSuperCall`.

## Disclaimer

Not heavily tested. Contributions welcome.
