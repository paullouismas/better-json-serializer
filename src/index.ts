import { Plugin, DeserializeFunction, SerializeFunction } from './Plugin';

interface IConfiguration {
  /** Whether plugins can be overwritten by others specifying the same constructor name */
  allowPluginsOverwrite: boolean;

  /** The key used to identify a serialized object */
  serializedObjectIdentifier: string;

  /** The default indentation to use when serializing data */
  defaultIndentation: number;
}

type PluginsRepository = Map<string, Plugin>;

interface ISerializedObject {
  /** The serialization version */
  version: number;

  /** The constructor of the non-standardized object */
  type: string;

  /** The standardized object */
  value: unknown;
}

/**
 * A tool that enables to use non-standard types in JSON.
 *
 * @class
 *
 * @author Mas Paul-Louis
 */
class BetterJSONSerializer {
  /** The config used by the serializer */
  private conf: IConfiguration = {
    allowPluginsOverwrite: false,

    serializedObjectIdentifier: '_@serialized-object',

    defaultIndentation: 0,
  };

  /** The list of plugins used as middlewares by the serializer */
  private plugins: PluginsRepository = new Map();

  // #region .setConfig()

  /**
   * Update the configuration.
   *
   * @param configuration - An object specifying the properties as keys, and the values.
   */
  public setConfig(configuration: Record<string, unknown>): void;
  /**
   * Update the configuration.
   *
   * @param configurationProperty - The configuration property to update.
   * @param value - The new value of the configuration property.
   */
  public setConfig(configurationProperty: string, value: unknown): void;
  public setConfig(
    configurationOrProperty: Record<string, unknown> | string,
    value?: unknown,
  ): void {
    // If the configuration is an object
    if (typeof configurationOrProperty === 'object') {
      const config = configurationOrProperty as Record<string, unknown>;

      // Call the setConfig foreach key/value pair
      Object.entries(config).forEach(([key, val]) => this.setConfig(key, val));

      return;
    }

    /** The configuration property */
    const key = configurationOrProperty as string;

    // Ensure that the configurationProperty exist in the configuration object
    if (!(key in this.conf)) {
      throw new ReferenceError(`Configuration property '${key}' does not exist.`);
    }

    // Ensure that the value of the configurationProperty is valid
    if (typeof value !== typeof this.conf[key]) {
      throw new TypeError(
        `Invalid type for configuration property '${key}', expected '${typeof this.conf[key]}'.`,
      );
    }

    // Update the configuration
    this.conf[key] = value;
  }

  // #endregion

  // #region .getConfig()

  /**
   * Retrieve the whole configuration object.
   *
   * @returns Return the whole configuration.
   */
  public getConfig(): IConfiguration;
  /**
   * Retrieve a configuration properties.
   *
   * @param configurationProperty - The name of the configuration property.
   *
   * @returns Return the value of the configuration property identified by `configurationProperty`.
   */
  public getConfig(configurationProperty: string): unknown;
  public getConfig(configurationProperty?: string): IConfiguration | unknown {
    // Check if property is 'undefined'
    if (configurationProperty === undefined) {
      // Return the whole configuration
      return { ...this.conf };
    }

    // Ensure that the configurationProperty exist in the configuration object
    if (!(configurationProperty in this.conf)) {
      throw new ReferenceError(`Configuration property '${configurationProperty}' does not exist.`);
    }

    // Return the configuration property value
    return this.conf[configurationProperty];
  }

  // #endregion

  // #region .use()

  /**
   * A function to add a plugin to the list of plugins used by the serializer.
   *
   * @param plugins - The plugin to add.
   */
  public use(plugin: Plugin): void;
  /**
   * A function to add plugins to the list of plugins used by the serializer.
   *
   * @param plugins - The array of plugins to add.
   */
  public use(plugins: Plugin[]): void;
  public use(pluginOrPlugins: Plugin | Plugin[]): void {
    if (Symbol.iterator in pluginOrPlugins) {
      const plugins = pluginOrPlugins as Plugin[];

      // Iterate through the plugins to add each of them individually
      Array.from(plugins).forEach((plugin) => this.use(plugin));

      return;
    }

    const plugin = pluginOrPlugins as Plugin;

    // Ensure the plugin is valid
    if (!(plugin instanceof Plugin)) {
      throw new TypeError(`The plugin is invalid.`);
    }

    if (this.plugins.has(plugin.name) && !this.conf.allowPluginsOverwrite) {
      // A plugin using this constructor name already exist and plugins override is disabled
      throw new Error(
        `Unable to add plugin for '${plugin.name}', a plugin using this constructor name already exist and plugins override is disabled.`,
      );
    }

    this.plugins.set(plugin.name, plugin);
  }

  // #endregion

  // #region .stringify()

  /**
   * Function to serialize an object into a JSON string
   * using the plugins as middlewares to serialize non-standard objects.
   *
   * @param value - The object to serialize.
   * @param replacer - The replacer function that alters the behavior of the serialization process.
   * @param space - The number of spaces to use to indent the JSON,
   *   overrides the default value from the configuration.
   *
   * @returns Returns the serialized JSON string.
   */
  public stringify(
    value: unknown,
    replacer: (key: string, value: unknown) => unknown = null,
    space: number = this.conf.defaultIndentation,
  ): string {
    /** The serialized JSON object */
    let json: string;

    try {
      json = JSON.stringify(
        value,
        (key, val) => {
          let source = val;

          // Use the replacer function on the raw value if provided
          if (replacer) {
            try {
              source = replacer.call(undefined, key, val);
            } catch (error) {
              throw new EvalError(
                `An error occured while calling the replacer function on key='${key}' and '${val}'.`,
              );
            }
          }

          /** The name of the constructor of `value` */
          let constructorName: string;
          // Test for special cases
          if (source === undefined) {
            constructorName = 'undefined';
          } else if (source === null) {
            constructorName = 'null';
          } else if (source === Infinity) {
            constructorName = 'infinity';
          } else if (Number.isNaN(source)) {
            constructorName = 'nan';
          } else {
            constructorName = source.constructor.name;
          }

          /** The plugin that should be used */
          const matchingPlugin = this.plugins.get(constructorName);

          // If no plugins matching this constructor has been found, return the raw value
          if (!matchingPlugin) {
            return source;
          }

          /** The serialized value */
          let serializedValue: unknown;

          try {
            // Serialize the object using the plugin
            serializedValue = matchingPlugin.serialize(key, source);
          } catch (error) {
            throw new EvalError(
              `Error while serializing type '${constructorName}'.\n\n${error.message}`,
            );
          }

          // Return the formated serialized object
          return {
            [this.conf.serializedObjectIdentifier]: {
              version: 1,
              type: constructorName,
              value: serializedValue,
            } as ISerializedObject,
          };
        },
        space,
      );
    } catch (error) {
      throw new EvalError(`Error while stringifying object.\n\n${error.message}`);
    }

    return json;
  }

  // #endregion

  // #region .parse()

  /**
   * Function to deserialize a JSON string into an object.
   * Serialized objects are converted using the plugins as middlewares.
   *
   * @param text - The JSON string to parse.
   * @param reviver - A function that will be called on each value before returning it.
   *
   * @returns Returns the deserialized object.
   */
  public parse<O = unknown>(
    text: string,
    reviver: (key: string, value: unknown) => unknown = null,
  ): O {
    /** The deserialized object */
    let object: unknown;

    try {
      object = JSON.parse(text, (key, value) => {
        // Check if the value is serialized, if not, returns it as raw
        if (
          typeof value !== 'object' ||
          value === null ||
          !(this.conf.serializedObjectIdentifier in value) ||
          Object.keys(value).length > 1
        ) {
          return value;
        }

        const { version, type: constructorName, value: serializedValue } = value[
          this.conf.serializedObjectIdentifier
        ] as ISerializedObject;

        /** The plugin that should be used */
        const matchingPlugin = this.plugins.get(constructorName);

        // If no plugins matching this constructor has been found, return the raw value
        if (!matchingPlugin) {
          return serializedValue;
        }

        switch (version) {
          case 1: {
            // Standard version, nothing to report

            break;
          }

          default: {
            throw new Error(`Unsupported serialization version '${version}'.`);
          }
        }

        /** The deserialized value */
        let deserializedValue: unknown;

        try {
          deserializedValue = matchingPlugin.deserialize(key, serializedValue);
        } catch (error) {
          throw new EvalError(
            `Error while deserializing type '${constructorName}'.\n\n${error.message}`,
          );
        }

        // Use the reviver function on the value if provided
        if (reviver) {
          try {
            deserializedValue = reviver.call(undefined, key, deserializedValue);
          } catch (error) {
            throw new EvalError(
              `An error occured while calling the reviver function on key='${key}' and '${deserializedValue}'.`,
            );
          }
        }

        // Return the formated deserialized object
        return deserializedValue;
      });
    } catch (error) {
      throw new EvalError(`Error while parsing object.\n\n${error.message}`);
    }

    return object as O;
  }

  // #endregion
}

export default BetterJSONSerializer;

/**
 * Create a new plugin.
 *
 * @param constructorName - The constructor used by the plugin.
 * @param serialize - The serialize function.
 * @param deserialize - The deserialize fucntion.
 */
export const createPlugin = (
  constructorName: string,
  serialize: SerializeFunction,
  deserialize: DeserializeFunction,
): Plugin => {
  if (typeof constructorName !== 'string') {
    throw new TypeError('The constructor name for the plugin must be a string.');
  }

  if (typeof serialize !== 'function') {
    throw new TypeError('The serialize property must be a function.');
  }

  if (typeof deserialize !== 'function') {
    throw new TypeError('The deserialize property must be a function.');
  }

  return new Plugin(constructorName, serialize, deserialize);
};
