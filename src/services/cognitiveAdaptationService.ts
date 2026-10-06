import { AssessmentGradeCalibrationProfile } from '../types';
import { getGradeCalibrationProfile, resolveGrade } from './assessmentGenerationProfileService';
import { AcademicSetting } from '../types';

export interface CognitiveAdaptationProfile extends AssessmentGradeCalibrationProfile {
  // Add custom fields if needed
  instructionComplexity: string;
  languageLoad: string;
  scaffoldingLevel: string;
}

export function getCognitiveAdaptationProfile(
  setting?: AcademicSetting | null,
  inputGrade?: number | string
): CognitiveAdaptationProfile | undefined {
  const grade = resolveGrade(setting, inputGrade);
  if (grade === undefined) return undefined;

  const calibration = getGradeCalibrationProfile(grade);

  // Map existing calibration to our CognitiveAdaptationProfile
  // You might need to adjust mapping logic based on your domain
  return {
    ...calibration,
    instructionComplexity: calibration.instructionLoad || 'STANDARD',
    languageLoad: calibration.readingLoad || 'STANDARD',
    scaffoldingLevel: grade <= 2 ? 'HIGH' : grade <= 6 ? 'MODERATE' : 'LOW',
  };
}
