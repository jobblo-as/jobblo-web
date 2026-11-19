import React, { useState } from 'react';
import { Image, View, type ImageProps } from 'react-native';
import { Skeleton } from './Skeleton';

/**
 * An Image that pulses (Skeleton) until it has loaded. Photos from the server, e.g. a draft
 * from "Dine utkast", take a moment on mobile data; an empty box looked broken.
 * A local file shows at once, so the placeholder is only seen for remote photos.
 */
export function LoadingImage({ style, onLoadEnd, ...props }: ImageProps) {
  const [loaded, setLoaded] = useState(false);
  return (
    <View style={style} className="overflow-hidden bg-surface-2">
      <Image
        {...props}
        style={[style, { position: 'absolute', top: 0, left: 0, margin: 0 }]}
        onLoadEnd={() => {
          setLoaded(true);
          onLoadEnd?.();
        }}
      />
      {loaded ? null : <Skeleton className="absolute inset-0 rounded-none" />}
    </View>
  );
}
