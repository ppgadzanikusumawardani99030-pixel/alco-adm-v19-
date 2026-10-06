import { getCognitiveAdaptationProfile } from '../cognitiveAdaptationService';

describe('CognitiveAdaptationService', () => {
  it('should resolve profile for Grade 1', () => {
    const profile = getCognitiveAdaptationProfile(null, 1);
    expect(profile).toBeDefined();
    expect(profile?.abstractionLevel).toBe('CONCRETE');
    expect(profile?.scaffoldingLevel).toBe('HIGH');
  });

  it('should resolve profile for Grade 6', () => {
    const profile = getCognitiveAdaptationProfile(null, 6);
    expect(profile).toBeDefined();
    expect(profile?.abstractionLevel).toBe('CONCRETE_TO_ABSTRACT');
    expect(profile?.scaffoldingLevel).toBe('MODERATE');
  });

  it('should resolve profile for Grade 9 (SMP)', () => {
    const profile = getCognitiveAdaptationProfile(null, 9);
    expect(profile).toBeDefined();
    expect(profile?.abstractionLevel).toBe('CONCRETE_TO_ABSTRACT');
    expect(profile?.scaffoldingLevel).toBe('LOW');
  });
});
