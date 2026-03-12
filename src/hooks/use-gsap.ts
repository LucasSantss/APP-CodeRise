import { useEffect, useRef } from 'react';
import gsap from 'gsap';

/**
 * Hook que anima os filhos diretos de um container com stagger usando GSAP.
 * fadeUp: slide de baixo para cima com fade-in.
 */
export function useGsapStagger<T extends HTMLElement>(
  deps: unknown[] = [],
  options?: {
    y?: number;
    stagger?: number;
    duration?: number;
    delay?: number;
    ease?: string;
  }
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ref.current!.children,
        { opacity: 0, y: options?.y ?? 24 },
        {
          opacity: 1,
          y: 0,
          duration: options?.duration ?? 0.55,
          stagger: options?.stagger ?? 0.08,
          delay: options?.delay ?? 0,
          ease: options?.ease ?? 'power3.out',
          clearProps: 'transform',
        }
      );
    }, ref);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}

/**
 * Hook que faz fade+slide-up num único elemento.
 */
export function useGsapFadeIn<T extends HTMLElement>(
  deps: unknown[] = [],
  options?: { y?: number; duration?: number; delay?: number; ease?: string }
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ref.current!,
        { opacity: 0, y: options?.y ?? 20 },
        {
          opacity: 1,
          y: 0,
          duration: options?.duration ?? 0.5,
          delay: options?.delay ?? 0,
          ease: options?.ease ?? 'power3.out',
          clearProps: 'transform',
        }
      );
    }, ref);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}

/**
 * Anima um número de 0 até o valor alvo (contador).
 */
export function useGsapCounter(
  target: number,
  deps: unknown[] = [],
  options?: { duration?: number; delay?: number; ease?: string; decimals?: number }
) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const obj = { val: 0 };
    const ctx = gsap.context(() => {
      gsap.to(obj, {
        val: target,
        duration: options?.duration ?? 1.2,
        delay: options?.delay ?? 0.2,
        ease: options?.ease ?? 'power2.out',
        onUpdate: () => {
          if (ref.current) {
            const decimals = options?.decimals ?? 0;
            ref.current.textContent = obj.val.toFixed(decimals);
          }
        },
      });
    });
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, target]);

  return ref;
}
